import { env } from "cloudflare:workers";
import type { JobSeed } from "./seed";
import { buildAnswersRevision } from "../lib/candidate-profile";

export const RADAR_STATUSES = ["pending", "calibrating", "active"] as const;
export type RadarStatus = (typeof RADAR_STATUSES)[number];

export type CandidateProfile = {
  candidateId: string;
  email: string;
  displayName: string;
  onboardingStatus: "draft" | "complete";
  radarStatus: RadarStatus;
  answersJson: string;
  isOwner: boolean;
};

export type AuthenticatedIdentity = {
  userId: string;
  email: string;
  displayName: string;
};

export class CandidateAccessDeniedError extends Error {
  constructor() {
    super("This Role Radar pilot is invitation-only.");
    this.name = "CandidateAccessDeniedError";
  }
}

export function isCandidateAccessDeniedError(
  error: unknown,
): error is CandidateAccessDeniedError {
  return error instanceof CandidateAccessDeniedError;
}

type CandidateProfileRow = {
  id: string;
  email: string;
  displayName: string;
  onboardingStatus: string;
  radarStatus: string;
  answersJson: string;
};

const MAX_AUTH_USER_ID_LENGTH = 512;
const MAX_EMAIL_LENGTH = 320;
const MAX_DISPLAY_NAME_LENGTH = 200;
const CANDIDATE_JOB_ID_SEPARATOR = "::";

let databaseInitialization: Promise<D1Database> | null = null;

type StarterRuntimeEnv = {
  DB?: D1Database;
  BOOTSTRAP_OWNER_EMAIL?: string;
  BOOTSTRAP_CANDIDATE_EMAILS?: string;
};

const CREATE_CANDIDATE_ACCESS_SQL = `
  CREATE TABLE IF NOT EXISTS candidate_access (
    email TEXT PRIMARY KEY NOT NULL,
    role TEXT NOT NULL DEFAULT 'candidate',
    status TEXT NOT NULL DEFAULT 'active',
    invited_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

const CREATE_CANDIDATE_PROFILES_SQL = `
  CREATE TABLE IF NOT EXISTS candidate_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    auth_user_id TEXT,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    onboarding_status TEXT NOT NULL DEFAULT 'draft',
    radar_status TEXT NOT NULL DEFAULT 'pending',
    answers_json TEXT NOT NULL DEFAULT '{}',
    answers_revision TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )
`;

const CREATE_JOBS_SQL = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY NOT NULL,
    candidate_id TEXT NOT NULL,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    location TEXT NOT NULL,
    work_mode TEXT NOT NULL,
    apply_url TEXT NOT NULL,
    description TEXT NOT NULL,
    fit_reason TEXT NOT NULL,
    tailor_advice TEXT NOT NULL,
    resume_fit TEXT NOT NULL,
    priority TEXT NOT NULL,
    priority_rank INTEGER NOT NULL,
    experience_fit TEXT NOT NULL,
    funding_label TEXT NOT NULL,
    funding_detail TEXT NOT NULL,
    funding_evidence TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    listing_status TEXT NOT NULL DEFAULT 'open',
    posted_at TEXT,
    last_verified_at TEXT NOT NULL
  )
`;

const CREATE_STATE_SQL = `
  CREATE TABLE IF NOT EXISTS user_job_state (
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not-started',
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, job_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )
`;

const GUARDED_UPSERT_JOB_SQL = `
  INSERT INTO jobs (
    id, candidate_id, company, role, location, work_mode, apply_url, description, fit_reason,
    tailor_advice, resume_fit, priority, priority_rank, experience_fit,
    funding_label, funding_detail, funding_evidence, first_seen_at,
    listing_status, posted_at, last_verified_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM candidate_profiles
    WHERE id = ?
      AND answers_revision = ?
      AND onboarding_status = 'complete'
      AND radar_status IN ('calibrating', 'active')
  )
  ON CONFLICT(id) DO UPDATE SET
    company = excluded.company,
    role = excluded.role,
    location = excluded.location,
    work_mode = excluded.work_mode,
    apply_url = excluded.apply_url,
    description = excluded.description,
    fit_reason = excluded.fit_reason,
    tailor_advice = excluded.tailor_advice,
    resume_fit = excluded.resume_fit,
    priority = excluded.priority,
    priority_rank = excluded.priority_rank,
    experience_fit = excluded.experience_fit,
    funding_label = excluded.funding_label,
    funding_detail = excluded.funding_detail,
    funding_evidence = excluded.funding_evidence,
    first_seen_at = jobs.first_seen_at,
    listing_status = excluded.listing_status,
    posted_at = excluded.posted_at,
    last_verified_at = excluded.last_verified_at
  WHERE jobs.candidate_id = excluded.candidate_id
`;

export function getD1(): D1Database {
  const binding = (env as unknown as StarterRuntimeEnv).DB;
  if (!binding) {
    throw new Error("The job CRM database binding is unavailable.");
  }
  return binding;
}

export function ensureJobDatabase(): Promise<D1Database> {
  if (!databaseInitialization) {
    databaseInitialization = initializeJobDatabase().catch((error) => {
      // A transient D1 failure must not poison this worker for its lifetime.
      databaseInitialization = null;
      throw error;
    });
  }

  return databaseInitialization;
}

async function initializeJobDatabase(): Promise<D1Database> {
  const db = getD1();
  await db.batch([
    db.prepare(CREATE_CANDIDATE_ACCESS_SQL),
    db.prepare(CREATE_CANDIDATE_PROFILES_SQL),
    db.prepare(CREATE_JOBS_SQL),
    db.prepare(CREATE_STATE_SQL),
  ]);

  await db.batch([
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_candidate_access_status ON candidate_access(status)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_profiles_auth_user_id ON candidate_profiles(auth_user_id)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_profiles_email ON candidate_profiles(email)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_jobs_candidate_listing_first_seen ON jobs(candidate_id, listing_status, first_seen_at, priority_rank)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_jobs_listing_first_seen ON jobs(listing_status, first_seen_at, priority_rank)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_user_job_state_user_status ON user_job_state(user_id, status)",
    ),
  ]);

  await bootstrapAccessRoster(db);

  await db.prepare("PRAGMA optimize").run();

  return db;
}

/**
 * Convert an ATS/employer source identifier into a globally unique D1 key.
 * The API accepts only a source ID; callers never control the candidate
 * namespace, which prevents one refresh from overwriting another feed.
 */
export function buildCandidateJobId(
  candidateId: string,
  sourceJobId: string,
): string {
  return `${candidateId}${CANDIDATE_JOB_ID_SEPARATOR}${sourceJobId}`;
}

export async function applyCandidateJobRefresh(
  db: D1Database,
  candidateId: string,
  answersRevision: string,
  jobs: readonly JobSeed[],
  closedJobs: readonly { id: string; lastVerifiedAt: string }[],
  activateRadar: boolean,
): Promise<{
  revisionMatched: boolean;
  closedJobCount: number;
  activated: boolean;
}> {
  await assertCandidateJobIds(db, candidateId, jobs);
  const requiredPrefix = `${candidateId}${CANDIDATE_JOB_ID_SEPARATOR}`;
  if (closedJobs.some((job) => !job.id.startsWith(requiredPrefix))) {
    throw new Error(
      `Candidate closure ids must start with "${requiredPrefix}".`,
    );
  }

  const guard = db
    .prepare(
      `UPDATE candidate_profiles
       SET answers_revision = answers_revision
       WHERE id = ?
         AND answers_revision = ?
         AND onboarding_status = 'complete'
         AND radar_status IN ('calibrating', 'active')`,
    )
    .bind(candidateId, answersRevision);

  const jobStatements = jobs.map((job) =>
    db
      .prepare(GUARDED_UPSERT_JOB_SQL)
      .bind(
        ...jobBindValues(job, candidateId),
        candidateId,
        answersRevision,
      ),
  );
  const closureStatements = closedJobs.map((job) =>
    db
      .prepare(
        `UPDATE jobs
         SET listing_status = 'closed', last_verified_at = ?
         WHERE id = ?
           AND candidate_id = ?
           AND EXISTS (
             SELECT 1 FROM candidate_profiles
             WHERE id = ?
               AND answers_revision = ?
               AND onboarding_status = 'complete'
               AND radar_status IN ('calibrating', 'active')
           )`,
      )
      .bind(
        job.lastVerifiedAt,
        job.id,
        candidateId,
        candidateId,
        answersRevision,
      ),
  );
  const activationStatement = db
    .prepare(
      `UPDATE candidate_profiles
       SET radar_status = 'active'
       WHERE id = ?
         AND answers_revision = ?
         AND onboarding_status = 'complete'
         AND radar_status IN ('calibrating', 'active')
         AND EXISTS (
           SELECT 1 FROM jobs
           WHERE candidate_id = ? AND listing_status = 'open'
         )`,
    )
    .bind(candidateId, answersRevision, candidateId);

  const results = await db.batch(
    [
      guard,
      ...jobStatements,
      ...closureStatements,
      ...(activateRadar ? [activationStatement] : []),
    ],
  );
  const closureStart = 1 + jobStatements.length;
  const closureResults = results.slice(
    closureStart,
    closureStart + closureStatements.length,
  );
  const activationResult = activateRadar ? results.at(-1) : undefined;
  return {
    revisionMatched: (results[0]?.meta.changes ?? 0) > 0,
    closedJobCount: closureResults.reduce(
      (total, result) => total + result.meta.changes,
      0,
    ),
    activated: (activationResult?.meta.changes ?? 0) > 0,
  };
}

async function assertCandidateJobIds(
  db: D1Database,
  candidateId: string,
  seedJobs: readonly JobSeed[],
): Promise<void> {
  const requiredPrefix = `${candidateId}${CANDIDATE_JOB_ID_SEPARATOR}`;
  const invalidJob = seedJobs.find((job) => !job.id.startsWith(requiredPrefix));
  if (invalidJob) {
    throw new Error(
      `Candidate job id "${invalidJob.id}" must start with "${requiredPrefix}".`,
    );
  }
  if (seedJobs.length === 0) return;

  const placeholders = seedJobs.map(() => "?").join(", ");
  const collision = await db
    .prepare(
      `SELECT id, candidate_id AS candidateId
       FROM jobs
       WHERE id IN (${placeholders}) AND candidate_id != ?
       LIMIT 1`,
    )
    .bind(...seedJobs.map((job) => job.id), candidateId)
    .first<{ id: string; candidateId: string }>();
  if (collision) {
    throw new Error(
      `Job id collision: "${collision.id}" already belongs to candidate "${collision.candidateId}".`,
    );
  }
}

function jobBindValues(job: JobSeed, candidateId: string) {
  return [
    job.id,
    candidateId,
    job.company,
    job.role,
    job.location,
    job.workMode,
    job.applyUrl,
    job.description,
    job.fitReason,
    job.tailorAdvice,
    job.resumeFit,
    job.priority,
    job.priorityRank,
    job.experienceFit,
    job.fundingLabel,
    job.fundingDetail,
    job.fundingEvidence,
    job.firstSeenAt ?? job.lastVerifiedAt,
    job.listingStatus ?? "open",
    job.postedAt,
    job.lastVerifiedAt,
  ] as const;
}

export async function getOrCreateCandidateProfile(
  db: D1Database,
  identity: AuthenticatedIdentity,
): Promise<CandidateProfile> {
  const userId = identity.userId.trim();
  const email = identity.email.trim().toLowerCase();
  const displayName = identity.displayName.trim() || email;

  if (
    !userId ||
    userId.length > MAX_AUTH_USER_ID_LENGTH ||
    !email ||
    email.length > MAX_EMAIL_LENGTH ||
    displayName.length > MAX_DISPLAY_NAME_LENGTH
  ) {
    throw new Error("The authenticated identity is invalid.");
  }

  const access = await assertCandidateAccess(db, email);

  let row = await findCandidateByAuthUserId(db, userId);
  if (row) return checkedCandidateProfile(row, email, access.role === "owner");

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE candidate_profiles
       SET auth_user_id = ?, updated_at = ?
       WHERE email = ? AND auth_user_id IS NULL`,
    )
    .bind(userId, now, email)
    .run();

  row = await findCandidateByAuthUserId(db, userId);
  if (row) return checkedCandidateProfile(row, email, access.role === "owner");

  const existingEmail = await db
    .prepare("SELECT id FROM candidate_profiles WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: string }>();
  if (existingEmail) {
    throw new Error("This email is already bound to another authenticated user.");
  }

  const candidateId = `candidate_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO candidate_profiles (
         id, auth_user_id, email, display_name, onboarding_status, radar_status,
         answers_json, answers_revision, created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, 'draft', 'pending', '{}', ?, ?, ?, NULL)
       ON CONFLICT(auth_user_id) DO NOTHING`,
    )
    .bind(
      candidateId,
      userId,
      email,
      displayName,
      buildAnswersRevision("{}"),
      now,
      now,
    )
    .run();

  row = await findCandidateByAuthUserId(db, userId);
  if (!row) {
    throw new Error("Unable to bind the authenticated candidate profile.");
  }
  return checkedCandidateProfile(row, email, access.role === "owner");
}

export async function ensureCandidateProfile(
  identity: AuthenticatedIdentity,
): Promise<CandidateProfile> {
  const db = await ensureJobDatabase();
  return getOrCreateCandidateProfile(db, identity);
}

async function assertCandidateAccess(
  db: D1Database,
  email: string,
): Promise<{ role: "owner" | "candidate" }> {
  const access = await db
    .prepare(
      `SELECT role
       FROM candidate_access
       WHERE email = ? AND status = 'active'
       LIMIT 1`,
    )
    .bind(email)
    .first<{ role: string }>();

  if (!access || (access.role !== "owner" && access.role !== "candidate")) {
    throw new CandidateAccessDeniedError();
  }
  return { role: access.role };
}

async function findCandidateByAuthUserId(
  db: D1Database,
  userId: string,
): Promise<CandidateProfileRow | null> {
  return db
    .prepare(
      `SELECT
         id,
         email,
         display_name AS displayName,
         onboarding_status AS onboardingStatus,
         radar_status AS radarStatus,
         answers_json AS answersJson
       FROM candidate_profiles
       WHERE auth_user_id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<CandidateProfileRow>();
}

function toCandidateProfile(
  row: CandidateProfileRow,
  isOwner: boolean,
): CandidateProfile {
  return {
    candidateId: row.id,
    email: row.email,
    displayName: row.displayName,
    onboardingStatus: row.onboardingStatus === "complete" ? "complete" : "draft",
    radarStatus: normalizeRadarStatus(row.radarStatus),
    answersJson: row.answersJson,
    isOwner,
  };
}

function checkedCandidateProfile(
  row: CandidateProfileRow,
  authenticatedEmail: string,
  isOwner: boolean,
): CandidateProfile {
  if (row.email !== authenticatedEmail) {
    throw new Error(
      "The authenticated user ID is already bound to a different email.",
    );
  }
  return toCandidateProfile(row, isOwner);
}

async function bootstrapAccessRoster(db: D1Database): Promise<void> {
  const runtimeEnv = env as unknown as StarterRuntimeEnv;
  const existingOwner = await db
    .prepare(
      `SELECT email
       FROM candidate_access
       WHERE role = 'owner' AND status = 'active'
       LIMIT 1`,
    )
    .first<{ email: string }>();
  if (existingOwner) return;

  const ownerEmail = normalizeConfiguredEmail(runtimeEnv.BOOTSTRAP_OWNER_EMAIL);
  if (!ownerEmail) return;

  const candidateEmails = (runtimeEnv.BOOTSTRAP_CANDIDATE_EMAILS ?? "")
    .split(",")
    .map(normalizeConfiguredEmail)
    .filter((email): email is string => Boolean(email) && email !== ownerEmail);
  const roster = [
    { email: ownerEmail, role: "owner" as const },
    ...candidateEmails.map((email) => ({ email, role: "candidate" as const })),
  ];
  const now = new Date().toISOString();
  await db.batch(
    roster.map(({ email, role }) =>
      db
        .prepare(
          `INSERT INTO candidate_access (
             email, role, status, invited_by, created_at, updated_at
           ) VALUES (?, ?, 'active', ?, ?, ?)
           ON CONFLICT(email) DO NOTHING`,
        )
        .bind(email, role, ownerEmail, now, now),
    ),
  );
}

function normalizeConfiguredEmail(value: string | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeRadarStatus(value: string): RadarStatus {
  return RADAR_STATUSES.includes(value as RadarStatus)
    ? (value as RadarStatus)
    : "pending";
}
