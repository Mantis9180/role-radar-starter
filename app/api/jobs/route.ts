import { NextRequest } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  ensureJobDatabase,
  getOrCreateCandidateProfile,
  isCandidateAccessDeniedError,
} from "../../../db/runtime";
import { JOB_STATUSES, type JobStatus } from "../../../db/seed";
import {
  isTrustedMutationRequest,
  privateJson,
  readBoundedJson,
} from "../../../lib/http-security";

const MAX_JOB_STATE_BODY_BYTES = 8_192;
const JOB_STATE_KEYS = new Set(["jobId", "status", "notes"]);

type JobRow = {
  id: string;
  company: string;
  role: string;
  location: string;
  workMode: string;
  applyUrl: string;
  description: string;
  fitReason: string;
  tailorAdvice: string;
  resumeFit: string;
  priority: string;
  priorityRank: number;
  experienceFit: string;
  fundingLabel: string;
  fundingDetail: string;
  fundingEvidence: string;
  firstSeenAt: string;
  listingStatus: "open" | "closed";
  postedAt: string | null;
  lastVerifiedAt: string;
  status: JobStatus;
  notes: string;
  stateUpdatedAt: string | null;
};

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return privateJson({ error: "Sign in required" }, { status: 401 });
  }

  try {
    const db = await ensureJobDatabase();
    const candidate = await getOrCreateCandidateProfile(db, user);
    const result = await db
      .prepare(
        `SELECT
          j.id,
          j.company,
          j.role,
          j.location,
          j.work_mode AS workMode,
          j.apply_url AS applyUrl,
          j.description,
          j.fit_reason AS fitReason,
          j.tailor_advice AS tailorAdvice,
          j.resume_fit AS resumeFit,
          j.priority,
          j.priority_rank AS priorityRank,
          j.experience_fit AS experienceFit,
          j.funding_label AS fundingLabel,
          j.funding_detail AS fundingDetail,
          j.funding_evidence AS fundingEvidence,
          j.first_seen_at AS firstSeenAt,
          j.listing_status AS listingStatus,
          j.posted_at AS postedAt,
          j.last_verified_at AS lastVerifiedAt,
          COALESCE(s.status, 'not-started') AS status,
          COALESCE(s.notes, '') AS notes,
          s.updated_at AS stateUpdatedAt
        FROM jobs j
        LEFT JOIN user_job_state s
          ON s.job_id = j.id AND s.user_id = ?
        WHERE j.candidate_id = ?
          AND (
            j.listing_status = 'open'
            OR (
              s.user_id IS NOT NULL
              AND (s.status != 'not-started' OR LENGTH(TRIM(s.notes)) > 0)
            )
          )
        ORDER BY j.first_seen_at DESC, j.priority_rank ASC`,
      )
      .bind(user.userId, candidate.candidateId)
      .all<JobRow>();

    const jobs = result.results ?? [];
    const latestVerifiedAt = jobs.reduce<string | null>(
      (latest, job) =>
        !latest || job.lastVerifiedAt > latest ? job.lastVerifiedAt : latest,
      null,
    );

    return privateJson(
      {
        jobs,
        meta: {
          latestVerifiedAt,
          owner: candidate.displayName,
          candidateId: candidate.candidateId,
          onboardingStatus: candidate.onboardingStatus,
          radarStatus: candidate.radarStatus,
        },
      },
    );
  } catch (error) {
    if (isCandidateAccessDeniedError(error)) {
      return privateJson({ error: error.message }, { status: 403 });
    }
    console.error("Unable to load job CRM", error);
    return privateJson(
      { error: "The role radar could not load. Try again shortly." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isTrustedMutationRequest(request)) {
    return privateJson(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  }

  const user = await getChatGPTUser();
  if (!user) {
    return privateJson({ error: "Sign in required" }, { status: 401 });
  }

  const parsedBody = await readBoundedJson(request, MAX_JOB_STATE_BODY_BYTES);
  if (!parsedBody.ok) return parsedBody.response;
  if (
    !isPlainRecord(parsedBody.value) ||
    Object.keys(parsedBody.value).some((key) => !JOB_STATE_KEYS.has(key))
  ) {
    return privateJson({ error: "Invalid request" }, { status: 400 });
  }
  const body = parsedBody.value;

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
  const status = hasStatus
    ? typeof body.status === "string" &&
      JOB_STATUSES.includes(body.status as JobStatus)
      ? (body.status as JobStatus)
      : null
    : undefined;
  const notes = hasNotes
    ? typeof body.notes === "string"
      ? body.notes.trim()
      : null
    : undefined;

  if (
    !jobId ||
    (!hasStatus && !hasNotes) ||
    status === null ||
    notes === null ||
    (typeof notes === "string" && notes.length > 4000)
  ) {
    return privateJson(
      { error: "Provide a valid status or a note under 4,000 characters." },
      { status: 400 },
    );
  }

  try {
    const db = await ensureJobDatabase();
    const candidate = await getOrCreateCandidateProfile(db, user);
    const exists = await db
      .prepare(
        "SELECT id FROM jobs WHERE id = ? AND candidate_id = ? LIMIT 1",
      )
      .bind(jobId, candidate.candidateId)
      .first();

    if (!exists) {
      return privateJson({ error: "Role not found" }, { status: 404 });
    }

    const updatedAt = new Date().toISOString();
    if (status !== undefined) {
      await db
        .prepare(
          `INSERT INTO user_job_state (user_id, job_id, status, notes, updated_at)
           VALUES (?, ?, ?, '', ?)
           ON CONFLICT(user_id, job_id) DO UPDATE SET
             status = excluded.status,
             updated_at = excluded.updated_at`,
        )
        .bind(user.userId, jobId, status, updatedAt)
        .run();
    }

    if (notes !== undefined) {
      await db
        .prepare(
          `INSERT INTO user_job_state (user_id, job_id, status, notes, updated_at)
           VALUES (?, ?, 'not-started', ?, ?)
           ON CONFLICT(user_id, job_id) DO UPDATE SET
             notes = excluded.notes,
             updated_at = excluded.updated_at`,
        )
        .bind(user.userId, jobId, notes, updatedAt)
        .run();
    }

    return privateJson({ ok: true, updatedAt });
  } catch (error) {
    if (isCandidateAccessDeniedError(error)) {
      return privateJson({ error: error.message }, { status: 403 });
    }
    console.error("Unable to update job CRM state", error);
    return privateJson(
      { error: "Your update was not saved. Try again." },
      { status: 500 },
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
