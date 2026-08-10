import {
  buildAnswersRevision,
  isCandidatePersona,
  type CandidatePersona,
} from "../lib/candidate-profile";

type RefreshProfileRow = {
  id: string;
  displayName: string;
  radarStatus: string;
  answersJson: string;
  answersRevision: string;
};

type ExistingRoleRow = {
  id: string;
  candidateId: string;
  company: string;
  role: string;
  applyUrl: string;
  listingStatus: "open" | "closed";
  firstSeenAt: string;
  lastVerifiedAt: string;
  postedAt: string | null;
  priority: "P0" | "P1" | "P2";
  priorityRank: number;
  resumeFit: string;
};

export type RefreshResumeVariant = {
  id: string;
  name: string;
  url: string;
  target: string;
  emphasis: string;
  isDefault: boolean;
};

export type CandidateRefreshContext = {
  candidateId: string;
  displayName: string;
  persona: CandidatePersona;
  radarStatus: "calibrating" | "active";
  profileSource: "onboarding-v2" | "legacy-spm";
  answersRevision: string;
  currentProfile: {
    currentTitle: string;
    currentCompany: string;
    pmExperienceYears: string;
    spmScopeYears: string;
    leadershipScope: string;
    strongestOutcomes: string;
  };
  target: {
    titles: string[];
    idealMandate: string;
    careerOutcomes: string;
    scopeLevels: string[];
    strengths: string[];
  };
  constraints: {
    currentLocation: string;
    noticePeriod: string;
    earliestStart: string;
    preferredLocations: string;
    workModes: string[];
    companyStages: string[];
    preferredDomains: string;
    minimumFixed: string;
    compensationNotes: string;
    equityPreference: string;
    companyExclusions: string;
  };
  priorityModel: {
    p0: string;
    p1: string;
    p2: string;
    hardExclusions: string;
    p0Examples: string;
    p1Examples: string;
    p2Examples: string;
  };
  resumeVariants: RefreshResumeVariant[];
  tailoringNotes: string;
  existingRoles: Array<{
    sourceJobId: string;
    company: string;
    role: string;
    applyUrl: string;
    listingStatus: "open" | "closed";
    firstSeenAt: string;
    lastVerifiedAt: string;
    postedAt: string | null;
    priority: "P0" | "P1" | "P2";
    priorityRank: number;
    resumeFit: string;
  }>;
};

export async function listCandidateRefreshContexts(
  db: D1Database,
): Promise<{ candidates: CandidateRefreshContext[]; skippedInvalidProfiles: number }> {
  const result = await db
    .prepare(
      `SELECT
         id,
         display_name AS displayName,
         radar_status AS radarStatus,
         answers_json AS answersJson,
         answers_revision AS answersRevision
       FROM candidate_profiles
       INNER JOIN candidate_access
         ON candidate_access.email = candidate_profiles.email
        AND candidate_access.status = 'active'
       WHERE candidate_profiles.onboarding_status = 'complete'
         AND candidate_profiles.radar_status IN ('calibrating', 'active')
       ORDER BY completed_at ASC, id ASC`,
    )
    .all<RefreshProfileRow>();

  const candidates: CandidateRefreshContext[] = [];
  let skippedInvalidProfiles = 0;
  for (const row of result.results ?? []) {
    await ensureStoredAnswersRevision(db, row);
    const context = parseCandidateRefreshContext(row);
    if (context) {
      candidates.push(context);
    } else {
      skippedInvalidProfiles += 1;
    }
  }

  await attachExistingRoles(db, candidates);

  return { candidates, skippedInvalidProfiles };
}

export async function getCandidateRefreshContext(
  db: D1Database,
  candidateId: string,
): Promise<CandidateRefreshContext | null> {
  const row = await db
    .prepare(
      `SELECT
         id,
         display_name AS displayName,
         radar_status AS radarStatus,
         answers_json AS answersJson,
         answers_revision AS answersRevision
       FROM candidate_profiles
       INNER JOIN candidate_access
         ON candidate_access.email = candidate_profiles.email
        AND candidate_access.status = 'active'
       WHERE candidate_profiles.id = ?
         AND candidate_profiles.onboarding_status = 'complete'
         AND candidate_profiles.radar_status IN ('calibrating', 'active')
       LIMIT 1`,
    )
    .bind(candidateId)
    .first<RefreshProfileRow>();

  if (row) await ensureStoredAnswersRevision(db, row);
  const context = row ? parseCandidateRefreshContext(row) : null;
  if (context) await attachExistingRoles(db, [context]);
  return context;
}

function parseCandidateRefreshContext(
  row: RefreshProfileRow,
): CandidateRefreshContext | null {
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.answersJson || "{}");
    if (!isPlainRecord(parsed)) return null;
    raw = parsed;
  } catch {
    return null;
  }

  // Completion consent is a hard boundary for automated role research.
  if (raw.consent !== true) return null;

  const persona = isCandidatePersona(raw.persona)
    ? raw.persona
    : raw.schemaVersion === 1
      ? "SPM"
      : null;
  if (!persona) return null;

  const profileSource =
    raw.schemaVersion === 1 ? "legacy-spm" : "onboarding-v2";

  const defaults = EMPTY_REFRESH_DEFAULTS;
  return {
    candidateId: row.id,
    displayName: row.displayName,
    persona,
    radarStatus: row.radarStatus === "active" ? "active" : "calibrating",
    profileSource,
    answersRevision: row.answersRevision,
    currentProfile: {
      currentTitle: readString(raw.currentTitle, defaults.currentTitle, 200),
      currentCompany: readString(raw.currentCompany, defaults.currentCompany, 200),
      pmExperienceYears: readString(
        raw.pmExperienceYears,
        defaults.pmExperienceYears,
        100,
      ),
      spmScopeYears: readString(raw.spmScopeYears, "", 100),
      leadershipScope: readString(raw.leadershipScope, defaults.leadershipScope, 1_000),
      strongestOutcomes: readString(
        raw.strongestOutcomes,
        defaults.strongestOutcomes,
        8_000,
      ),
    },
    target: {
      titles: readStringArray(raw.targetTitles, defaults.targetTitles, 6, 200),
      idealMandate: readString(raw.idealMandate, defaults.idealMandate, 4_000),
      careerOutcomes: readString(raw.careerOutcomes, "", 1_000),
      scopeLevels: readStringArray(raw.scopeLevels, [], 5, 200),
      strengths: readStringArray(raw.strengths, defaults.strengths, 10, 200),
    },
    constraints: {
      currentLocation: readString(raw.currentLocation, defaults.currentLocation, 300),
      noticePeriod: readString(raw.noticePeriod, "", 200),
      earliestStart: readString(raw.earliestStart, "", 20),
      preferredLocations: readString(
        raw.preferredLocations,
        defaults.preferredLocations,
        1_000,
      ),
      workModes: readStringArray(raw.workModes, defaults.workModes, 5, 200),
      companyStages: readStringArray(raw.companyStages, defaults.companyStages, 5, 200),
      preferredDomains: readString(raw.preferredDomains, defaults.preferredDomains, 1_000),
      minimumFixed: readString(raw.minimumFixed, "", 200),
      compensationNotes: readString(raw.compensationNotes, "", 2_000),
      equityPreference: readString(raw.equityPreference, defaults.equityPreference, 100),
      companyExclusions: readString(raw.companyExclusions, "", 4_000),
    },
    priorityModel: {
      p0: readString(raw.p0Definition, defaults.p0Definition, 4_000),
      p1: readString(raw.p1Definition, defaults.p1Definition, 4_000),
      p2: readString(raw.p2Definition, defaults.p2Definition, 4_000),
      hardExclusions: readString(raw.hardExclusions, defaults.hardExclusions, 4_000),
      p0Examples: readString(raw.p0Examples, "", 4_000),
      p1Examples: readString(raw.p1Examples, "", 4_000),
      p2Examples: readString(raw.p2Examples, "", 4_000),
    },
    resumeVariants: readResumeVariants(raw.resumeVariants, defaults.resumeVariants),
    tailoringNotes: readString(raw.tailoringNotes, defaults.tailoringNotes, 4_000),
    existingRoles: [],
  };
}

async function attachExistingRoles(
  db: D1Database,
  contexts: CandidateRefreshContext[],
): Promise<void> {
  if (!contexts.length) return;
  const candidateIds = contexts.map((context) => context.candidateId);
  const placeholders = candidateIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT
         id,
         candidate_id AS candidateId,
         company,
         role,
         apply_url AS applyUrl,
         listing_status AS listingStatus,
         first_seen_at AS firstSeenAt,
         last_verified_at AS lastVerifiedAt,
         posted_at AS postedAt,
         priority,
         priority_rank AS priorityRank,
         resume_fit AS resumeFit
       FROM jobs
       WHERE candidate_id IN (${placeholders})
       ORDER BY candidate_id ASC, first_seen_at DESC, priority_rank ASC`,
    )
    .bind(...candidateIds)
    .all<ExistingRoleRow>();

  const contextByCandidate = new Map(
    contexts.map((context) => [context.candidateId, context]),
  );
  for (const row of result.results ?? []) {
    const context = contextByCandidate.get(row.candidateId);
    if (!context) continue;
    const prefix = `${row.candidateId}::`;
    const sourceJobId = row.id.startsWith(prefix)
      ? row.id.slice(prefix.length)
      : "";
    if (!sourceJobId) continue;
    context.existingRoles.push({
      sourceJobId,
      company: row.company,
      role: row.role,
      applyUrl: row.applyUrl,
      listingStatus: row.listingStatus,
      firstSeenAt: row.firstSeenAt,
      lastVerifiedAt: row.lastVerifiedAt,
      postedAt: row.postedAt,
      priority: row.priority,
      priorityRank: row.priorityRank,
      resumeFit: row.resumeFit,
    });
  }
}

function readString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim()
    ? value.slice(0, maxLength)
    : fallback;
}

async function ensureStoredAnswersRevision(
  db: D1Database,
  row: RefreshProfileRow,
): Promise<void> {
  if (row.answersRevision) return;
  const revision = buildAnswersRevision(row.answersJson);
  await db
    .prepare(
      `UPDATE candidate_profiles
       SET answers_revision = ?
       WHERE id = ? AND answers_revision = ''`,
    )
    .bind(revision, row.id)
    .run();
  row.answersRevision = revision;
}

function readStringArray(
  value: unknown,
  fallback: string[],
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().slice(0, maxItemLength);
    if (normalized && !result.includes(normalized)) result.push(normalized);
    if (result.length === maxItems) break;
  }
  return result.length ? result : [...fallback];
}

function readResumeVariants(
  value: unknown,
  fallback: RefreshResumeVariant[],
): RefreshResumeVariant[] {
  if (!Array.isArray(value)) return fallback.map((variant) => ({ ...variant }));
  const variants: RefreshResumeVariant[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, 6)) {
    if (!isPlainRecord(item)) continue;
    const id = readString(item.id, "", 100);
    const name = readString(item.name, "", 200);
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    variants.push({
      id,
      name,
      url: readString(item.url, "", 2_048),
      target: readString(item.target, "", 1_000),
      emphasis: readString(item.emphasis, "", 1_000),
      isDefault: item.isDefault === true,
    });
  }
  return variants.length ? variants : fallback.map((variant) => ({ ...variant }));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const EMPTY_REFRESH_DEFAULTS = {
  currentTitle: "",
  currentCompany: "",
  pmExperienceYears: "",
  leadershipScope: "",
  strongestOutcomes: "",
  targetTitles: [] as string[],
  idealMandate: "",
  strengths: [] as string[],
  currentLocation: "",
  preferredLocations: "",
  workModes: [] as string[],
  companyStages: [] as string[],
  preferredDomains: "",
  equityPreference: "",
  p0Definition: "",
  p1Definition: "",
  p2Definition: "",
  hardExclusions: "",
  resumeVariants: [] as RefreshResumeVariant[],
  tailoringNotes: "",
};
