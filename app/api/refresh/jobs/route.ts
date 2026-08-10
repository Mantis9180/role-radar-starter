import { NextRequest, NextResponse } from "next/server";
import { getCandidateRefreshContext } from "../../../../db/refresh";
import {
  applyCandidateJobRefresh,
  buildCandidateJobId,
} from "../../../../db/runtime";
import type { JobSeed } from "../../../../db/seed";
import {
  isTrustedMutationRequest,
  privateJson,
  readBoundedJson,
} from "../../../../lib/http-security";
import { authorizeRefreshOwner } from "../authorization";

const MAX_JOBS_PER_REFRESH = 250;
const MAX_REFRESH_BODY_BYTES = 2_000_000;
const SOURCE_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const BODY_KEYS = new Set([
  "candidateId",
  "answersRevision",
  "activateRadar",
  "closedRoles",
  "jobs",
]);
const CLOSED_ROLE_KEYS = new Set(["sourceJobId", "lastVerifiedAt"]);
const JOB_KEYS = new Set([
  "sourceJobId",
  "company",
  "role",
  "location",
  "workMode",
  "applyUrl",
  "description",
  "fitReason",
  "tailorAdvice",
  "resumeFit",
  "priority",
  "priorityRank",
  "experienceFit",
  "fundingLabel",
  "fundingDetail",
  "fundingEvidence",
  "firstSeenAt",
  "listingStatus",
  "postedAt",
  "lastVerifiedAt",
]);

type ParsedRefreshJob = {
  sourceJobId: string;
  job: Omit<JobSeed, "id">;
};

type ParsedClosedRole = {
  sourceJobId: string;
  lastVerifiedAt: string;
};

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isTrustedMutationRequest(request)) {
    return privateJson(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  }

  try {
    const authorization = await authorizeRefreshOwner();
    if (!authorization.ok) return authorization.response;

    const parsedBody = await readBoundedJson(request, MAX_REFRESH_BODY_BYTES);
    if (!parsedBody.ok) return parsedBody.response;

    return await ingestCandidateJobRefresh(authorization.db, parsedBody.value);
  } catch (error) {
    console.error("Unable to ingest a candidate role refresh", error);
    return jsonError("Role refresh could not be saved", 500);
  }
}

export async function ingestCandidateJobRefresh(
  db: D1Database,
  body: unknown,
): Promise<NextResponse> {
  if (
    !isPlainRecord(body) ||
    Object.keys(body).some((key) => !BODY_KEYS.has(key))
  ) {
    return jsonError("Invalid refresh request", 400);
  }

  const candidateId = readRequiredString(body.candidateId, 200);
  const answersRevision = readRequiredString(body.answersRevision, 100);
  const activateRadar = body.activateRadar === true;
  const rawClosedRoles = body.closedRoles ?? [];
  if (
    !candidateId ||
    candidateId.includes("::") ||
    !answersRevision ||
    !Array.isArray(body.jobs) ||
    !Array.isArray(rawClosedRoles) ||
    body.jobs.length + rawClosedRoles.length > MAX_JOBS_PER_REFRESH
  ) {
    return jsonError(
      `Provide a candidate, context revision, and no more than ${MAX_JOBS_PER_REFRESH} combined jobs and closures.`,
      400,
    );
  }

  const context = await getCandidateRefreshContext(db, candidateId);
  if (!context) {
    return jsonError("Candidate is not eligible for refresh", 404);
  }
  if (context.answersRevision !== answersRevision) {
    return jsonError(
      "Candidate criteria changed; fetch a fresh context before writing roles.",
      409,
    );
  }

  const acceptedResumeNames = new Map<string, Set<string>>();
  for (const variant of context.resumeVariants) {
    addResumeIdentifier(acceptedResumeNames, variant.id, variant.name);
    addResumeIdentifier(acceptedResumeNames, variant.name, variant.name);
  }

  const parsedJobs: ParsedRefreshJob[] = [];
  const sourceIds = new Set<string>();
  for (const value of body.jobs) {
    const parsed = parseRefreshJob(value, acceptedResumeNames);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    if (sourceIds.has(parsed.value.sourceJobId)) {
      return jsonError("Each sourceJobId must be unique within a refresh.", 400);
    }
    sourceIds.add(parsed.value.sourceJobId);
    parsedJobs.push(parsed.value);
  }

  const parsedClosedRoles: ParsedClosedRole[] = [];
  for (const value of rawClosedRoles) {
    const parsed = parseClosedRole(value);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    if (sourceIds.has(parsed.value.sourceJobId)) {
      return jsonError(
        "A sourceJobId cannot be both updated and closed in one refresh.",
        400,
      );
    }
    sourceIds.add(parsed.value.sourceJobId);
    parsedClosedRoles.push(parsed.value);
  }

  if (
    context.radarStatus === "calibrating" &&
    activateRadar &&
    !parsedJobs.some((item) => item.job.listingStatus === "open")
  ) {
    return jsonError(
      "A calibrating radar needs at least one open role from the current criteria before activation.",
      400,
    );
  }

  const seeds: JobSeed[] = parsedJobs.map(({ sourceJobId, job }) => ({
    id: buildCandidateJobId(candidateId, sourceJobId),
    ...job,
  }));

  const refreshResult = await applyCandidateJobRefresh(
    db,
    candidateId,
    answersRevision,
    seeds,
    parsedClosedRoles.map((role) => ({
      id: buildCandidateJobId(candidateId, role.sourceJobId),
      lastVerifiedAt: role.lastVerifiedAt,
    })),
    activateRadar,
  );
  if (!refreshResult.revisionMatched) {
    return jsonError(
      "Candidate criteria changed; fetch a fresh context before writing roles.",
      409,
    );
  }

  const activated = context.radarStatus === "active" || refreshResult.activated;

  return privateJson(
    {
      ok: true,
      candidateId,
      acceptedJobCount: seeds.length,
      closedJobCount: refreshResult.closedJobCount,
      radarStatus: activated ? "active" : context.radarStatus,
    },
  );
}

function parseClosedRole(
  value: unknown,
): { ok: true; value: ParsedClosedRole } | { ok: false; error: string } {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).some((key) => !CLOSED_ROLE_KEYS.has(key))
  ) {
    return { ok: false, error: "A closed role contains unsupported fields." };
  }
  const sourceJobId = readRequiredString(value.sourceJobId, 200);
  const lastVerifiedAt = readRequiredString(value.lastVerifiedAt, 100);
  if (!sourceJobId || !SOURCE_JOB_ID_PATTERN.test(sourceJobId)) {
    return { ok: false, error: "A closed role needs a valid sourceJobId." };
  }
  if (!lastVerifiedAt || !isIsoTimestamp(lastVerifiedAt)) {
    return {
      ok: false,
      error: `Closed role ${sourceJobId} needs a valid lastVerifiedAt timestamp.`,
    };
  }
  return { ok: true, value: { sourceJobId, lastVerifiedAt } };
}

function parseRefreshJob(
  value: unknown,
  acceptedResumeNames: Map<string, Set<string>>,
): { ok: true; value: ParsedRefreshJob } | { ok: false; error: string } {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).some((key) => !JOB_KEYS.has(key))
  ) {
    return { ok: false, error: "A job contains unsupported fields." };
  }

  const sourceJobId = readRequiredString(value.sourceJobId, 200);
  if (!sourceJobId || !SOURCE_JOB_ID_PATTERN.test(sourceJobId)) {
    return {
      ok: false,
      error:
        "sourceJobId must use 1–200 letters, numbers, dots, underscores, or hyphens.",
    };
  }

  const resumeFitInput = readRequiredString(value.resumeFit, 200);
  const resumeCandidates = resumeFitInput
    ? acceptedResumeNames.get(resumeFitInput)
    : undefined;
  const resumeFit =
    resumeCandidates?.size === 1 ? [...resumeCandidates][0] : undefined;
  if (!resumeFit) {
    return {
      ok: false,
      error: `Job ${sourceJobId} must use one of the candidate's resume variants.`,
    };
  }

  const requiredStrings = {
    company: readRequiredString(value.company, 200),
    role: readRequiredString(value.role, 300),
    location: readRequiredString(value.location, 300),
    workMode: readRequiredString(value.workMode, 200),
    applyUrl: readRequiredString(value.applyUrl, 2_048),
    description: readRequiredString(value.description, 2_000),
    fitReason: readRequiredString(value.fitReason, 4_000),
    tailorAdvice: readRequiredString(value.tailorAdvice, 4_000),
    experienceFit: readRequiredString(value.experienceFit, 500),
    fundingLabel: readRequiredString(value.fundingLabel, 300),
    fundingDetail: readRequiredString(value.fundingDetail, 2_000),
    firstSeenAt: readRequiredString(value.firstSeenAt, 100),
    lastVerifiedAt: readRequiredString(value.lastVerifiedAt, 100),
  };
  const missingField = Object.entries(requiredStrings).find(([, item]) => !item);
  if (missingField) {
    return {
      ok: false,
      error: `Job ${sourceJobId} has an invalid or missing ${missingField[0]}.`,
    };
  }
  if (!isHttpsUrl(requiredStrings.applyUrl!)) {
    return { ok: false, error: `Job ${sourceJobId} needs a valid HTTPS applyUrl.` };
  }
  if (
    !isIsoTimestamp(requiredStrings.firstSeenAt!) ||
    !isIsoTimestamp(requiredStrings.lastVerifiedAt!)
  ) {
    return {
      ok: false,
      error: `Job ${sourceJobId} needs valid firstSeenAt and lastVerifiedAt timestamps.`,
    };
  }

  const priority = value.priority;
  const priorityRank = value.priorityRank;
  const fundingEvidence = value.fundingEvidence;
  const listingStatus = value.listingStatus;
  const postedAt = value.postedAt;
  if (
    (priority !== "P0" && priority !== "P1" && priority !== "P2") ||
    !Number.isInteger(priorityRank) ||
    (priorityRank as number) < 1 ||
    (priorityRank as number) > 10_000 ||
    (fundingEvidence !== "Verified" &&
      fundingEvidence !== "Inference" &&
      fundingEvidence !== "Unknown") ||
    (listingStatus !== "open" && listingStatus !== "closed") ||
    (postedAt !== null &&
      (typeof postedAt !== "string" || !isCalendarDate(postedAt)))
  ) {
    return { ok: false, error: `Job ${sourceJobId} has invalid ranking or evidence fields.` };
  }

  return {
    ok: true,
    value: {
      sourceJobId,
      job: {
        company: requiredStrings.company!,
        role: requiredStrings.role!,
        location: requiredStrings.location!,
        workMode: requiredStrings.workMode!,
        applyUrl: requiredStrings.applyUrl!,
        description: requiredStrings.description!,
        fitReason: requiredStrings.fitReason!,
        tailorAdvice: requiredStrings.tailorAdvice!,
        resumeFit: resumeFit as JobSeed["resumeFit"],
        priority,
        priorityRank: priorityRank as number,
        experienceFit: requiredStrings.experienceFit!,
        fundingLabel: requiredStrings.fundingLabel!,
        fundingDetail: requiredStrings.fundingDetail!,
        fundingEvidence,
        firstSeenAt: requiredStrings.firstSeenAt!,
        listingStatus,
        postedAt,
        lastVerifiedAt: requiredStrings.lastVerifiedAt!,
      },
    },
  };
}

function addResumeIdentifier(
  index: Map<string, Set<string>>,
  identifier: string,
  displayName: string,
): void {
  const matches = index.get(identifier) ?? new Set<string>();
  matches.add(displayName);
  index.set(identifier, matches);
}

function readRequiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= maxLength ? result : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function jsonError(message: string, status: number) {
  return privateJson({ error: message }, { status });
}
