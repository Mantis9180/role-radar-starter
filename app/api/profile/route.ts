import { NextRequest } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  ensureJobDatabase,
  getOrCreateCandidateProfile,
  isCandidateAccessDeniedError,
} from "../../../db/runtime";
import {
  type CandidatePersona,
  ONBOARDING_SCHEMA_VERSION,
  SCOPE_OPTIONS_BY_PERSONA,
  TARGET_TITLES_BY_PERSONA,
  buildAnswersRevision,
  isCandidatePersona,
} from "../../../lib/candidate-profile";
import {
  isTrustedMutationRequest,
  privateJson,
  readBoundedJson,
} from "../../../lib/http-security";

const LEGACY_ANSWERS_SCHEMA_VERSION = 1;
const ANSWERS_SCHEMA_VERSION = ONBOARDING_SCHEMA_VERSION;
const MAX_ANSWERS_JSON_LENGTH = 64_000;
const MAX_PROFILE_BODY_BYTES = 96_000;
const MAX_RESUME_VARIANTS = 6;
const PROFILE_PATCH_KEYS = new Set(["onboardingStatus", "answersJson"]);

const STRING_FIELDS = {
  preferredName: 120,
  currentTitle: 200,
  currentCompany: 200,
  pmExperienceYears: 100,
  idealMandate: 4_000,
  careerOutcomes: 1_000,
  spmScopeYears: 100,
  strongestOutcomes: 8_000,
  leadershipScope: 1_000,
  currentLocation: 300,
  noticePeriod: 200,
  earliestStart: 20,
  preferredLocations: 1_000,
  preferredDomains: 1_000,
  minimumFixed: 200,
  compensationNotes: 2_000,
  equityPreference: 100,
  companyExclusions: 4_000,
  p0Definition: 4_000,
  p1Definition: 4_000,
  p2Definition: 4_000,
  hardExclusions: 4_000,
  p0Examples: 4_000,
  p1Examples: 4_000,
  p2Examples: 4_000,
  tailoringNotes: 4_000,
} as const;

const ARRAY_FIELDS = {
  targetTitles: {
    maxItems: 6,
    allowed: [...new Set(Object.values(TARGET_TITLES_BY_PERSONA).flat())],
  },
  scopeLevels: {
    maxItems: 5,
    allowed: [...new Set(Object.values(SCOPE_OPTIONS_BY_PERSONA).flat())],
  },
  strengths: {
    maxItems: 10,
    allowed: [
      "Zero-to-one",
      "Scale & optimisation",
      "Growth & activation",
      "Monetisation & pricing",
      "B2B SaaS",
      "Platform / APIs",
      "AI / data products",
      "Marketplace / consumer",
      "Product strategy",
      "Team leadership",
    ],
  },
  workModes: {
    maxItems: 5,
    allowed: ["Hybrid", "Remote", "On-site", "Relocation", "Global remote"],
  },
  companyStages: {
    maxItems: 5,
    allowed: [
      "Seed–Series A",
      "Series B–C",
      "Late-stage private",
      "Profitable scale-up",
      "Public / large company",
    ],
  },
} as const;

type StringField = keyof typeof STRING_FIELDS;
type ArrayField = keyof typeof ARRAY_FIELDS;

type ResumeVariant = {
  id: string;
  name: string;
  url: string;
  target: string;
  emphasis: string;
  isDefault: boolean;
};

type ValidatedAnswers = Record<StringField, string> &
  Record<ArrayField, string[]> & {
    schemaVersion: typeof ANSWERS_SCHEMA_VERSION;
    persona: CandidatePersona | "";
    resumeVariants: ResumeVariant[];
    consent: boolean;
  };

const ANSWER_KEYS = new Set([
  "schemaVersion",
  "persona",
  ...Object.keys(STRING_FIELDS),
  ...Object.keys(ARRAY_FIELDS),
  "resumeVariants",
  "consent",
]);

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return privateJson({ error: "Sign in required" }, { status: 401 });
  }

  try {
    const db = await ensureJobDatabase();
    const profile = await getOrCreateCandidateProfile(db, user);
    return privateJson({ profile });
  } catch (error) {
    if (isCandidateAccessDeniedError(error)) {
      return privateJson({ error: error.message }, { status: 403 });
    }
    console.error("Unable to load candidate profile", error);
    return privateJson(
      { error: "Your candidate profile could not load. Try again shortly." },
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

  const parsedBody = await readBoundedJson(request, MAX_PROFILE_BODY_BYTES);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value;

  if (
    !isPlainObject(body) ||
    Object.keys(body).some((key) => !PROFILE_PATCH_KEYS.has(key))
  ) {
    return privateJson({ error: "Invalid request" }, { status: 400 });
  }

  const onboardingStatus = body.onboardingStatus;
  const rawAnswersJson = body.answersJson;
  if (
    (onboardingStatus !== "draft" && onboardingStatus !== "complete") ||
    typeof rawAnswersJson !== "string" ||
    rawAnswersJson.length > MAX_ANSWERS_JSON_LENGTH
  ) {
    return privateJson(
      { error: "Provide valid onboarding answers under 64,000 characters." },
      { status: 400 },
    );
  }

  let parsedAnswers: unknown;
  try {
    parsedAnswers = JSON.parse(rawAnswersJson);
  } catch {
    return privateJson(
      { error: "Onboarding answers must be a valid JSON object." },
      { status: 400 },
    );
  }

  const validation = validateAnswers(parsedAnswers, onboardingStatus);
  if (!validation.ok) {
    return privateJson({ error: validation.error }, { status: 400 });
  }

  const answersJson = JSON.stringify(validation.answers);
  const answersRevision = buildAnswersRevision(answersJson);
  if (answersJson.length > MAX_ANSWERS_JSON_LENGTH) {
    return privateJson(
      { error: "Onboarding answers must remain under 64,000 characters." },
      { status: 400 },
    );
  }

  try {
    const db = await ensureJobDatabase();
    const profile = await getOrCreateCandidateProfile(db, user);
    const updatedAt = new Date().toISOString();
    const completedAt = onboardingStatus === "complete" ? updatedAt : null;

    if (onboardingStatus === "complete") {
      await db.batch([
        db
          .prepare(
            `UPDATE candidate_profiles
             SET onboarding_status = ?, answers_json = ?, answers_revision = ?, updated_at = ?, completed_at = ?, radar_status = 'calibrating'
             WHERE id = ? AND auth_user_id = ?`,
          )
          .bind(
            onboardingStatus,
            answersJson,
            answersRevision,
            updatedAt,
            completedAt,
            profile.candidateId,
            user.userId,
          ),
        db
          .prepare(
            `UPDATE jobs
             SET listing_status = 'closed'
             WHERE candidate_id = ? AND listing_status = 'open'`,
          )
          .bind(profile.candidateId),
      ]);
    } else {
      await db
        .prepare(
          `UPDATE candidate_profiles
           SET onboarding_status = ?, answers_json = ?, answers_revision = ?, updated_at = ?, completed_at = ?
           WHERE id = ? AND auth_user_id = ?`,
        )
        .bind(
          onboardingStatus,
          answersJson,
          answersRevision,
          updatedAt,
          completedAt,
          profile.candidateId,
          user.userId,
        )
        .run();
    }

    const currentRadarStatus =
      "radarStatus" in profile && typeof profile.radarStatus === "string"
        ? profile.radarStatus
        : "pending";

    return privateJson(
      {
        profile: {
          ...profile,
          onboardingStatus,
          answersJson,
          radarStatus:
            onboardingStatus === "complete" ? "calibrating" : currentRadarStatus,
        },
      },
    );
  } catch (error) {
    if (isCandidateAccessDeniedError(error)) {
      return privateJson({ error: error.message }, { status: 403 });
    }
    console.error("Unable to update candidate profile", error);
    return privateJson(
      { error: "Your onboarding answers were not saved. Try again." },
      { status: 500 },
    );
  }
}

function validateAnswers(
  value: unknown,
  status: "draft" | "complete",
):
  | { ok: true; answers: ValidatedAnswers }
  | { ok: false; error: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      error: "Onboarding answers must be a valid JSON object.",
    };
  }

  if (
    value.schemaVersion !== ANSWERS_SCHEMA_VERSION &&
    value.schemaVersion !== LEGACY_ANSWERS_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      error: `Unsupported onboarding schema. Expected version ${ANSWERS_SCHEMA_VERSION}.`,
    };
  }

  if (Object.keys(value).some((key) => !ANSWER_KEYS.has(key))) {
    return {
      ok: false,
      error: "Onboarding answers contain unsupported fields.",
    };
  }

  const answers = {
    schemaVersion: ANSWERS_SCHEMA_VERSION,
  } as ValidatedAnswers;

  const isLegacy = value.schemaVersion === LEGACY_ANSWERS_SCHEMA_VERSION;
  if (isLegacy) {
    answers.persona = "SPM";
  } else if (value.persona === "") {
    answers.persona = "";
  } else if (isCandidatePersona(value.persona)) {
    answers.persona = value.persona;
  } else {
    return {
      ok: false,
      error: "Choose a valid APM, PM or SPM persona.",
    };
  }

  for (const [field, maxLength] of Object.entries(STRING_FIELDS) as [
    StringField,
    number,
  ][]) {
    const fieldValue = value[field];
    if (fieldValue === undefined) {
      answers[field] = "";
      continue;
    }
    if (typeof fieldValue !== "string" || fieldValue.length > maxLength) {
      return {
        ok: false,
        error: `${field} must be text under ${maxLength.toLocaleString()} characters.`,
      };
    }
    answers[field] = fieldValue;
  }

  for (const [field, config] of Object.entries(ARRAY_FIELDS) as [
    ArrayField,
    { maxItems: number; allowed: readonly string[] },
  ][]) {
    const fieldValue = value[field];
    if (fieldValue === undefined) {
      answers[field] = [];
      continue;
    }
    if (
      !Array.isArray(fieldValue) ||
      fieldValue.length > config.maxItems ||
      fieldValue.some(
        (item) => typeof item !== "string" || !config.allowed.includes(item),
      ) ||
      new Set(fieldValue).size !== fieldValue.length
    ) {
      return {
        ok: false,
        error: `${field} contains invalid or too many selections.`,
      };
    }
    answers[field] = fieldValue;
  }

  if (
    answers.targetTitles.length > 0 &&
    (!answers.persona ||
      answers.targetTitles.some(
        (title) =>
          !TARGET_TITLES_BY_PERSONA[
            answers.persona as CandidatePersona
          ].includes(title),
      ))
  ) {
    return {
      ok: false,
      error: "Target titles must match the selected APM, PM or SPM persona.",
    };
  }

  if (
    answers.scopeLevels.length > 0 &&
    (!answers.persona ||
      answers.scopeLevels.some(
        (scope) =>
          !SCOPE_OPTIONS_BY_PERSONA[
            answers.persona as CandidatePersona
          ].includes(scope),
      ))
  ) {
    return {
      ok: false,
      error: "Target scope must match the selected APM, PM or SPM persona.",
    };
  }

  if (value.consent !== undefined && typeof value.consent !== "boolean") {
    return { ok: false, error: "Consent must be true or false." };
  }
  answers.consent = value.consent === true;

  const resumeValidation = validateResumeVariants(value.resumeVariants, status);
  if (!resumeValidation.ok) return resumeValidation;
  answers.resumeVariants = resumeValidation.resumeVariants;

  if (status === "complete") {
    const missing = [
      !answers.persona && "candidate persona",
      !answers.targetTitles.length && "target titles",
      !answers.idealMandate.trim() && "ideal mandate",
      !answers.scopeLevels.length && "target scope",
      !answers.strengths.length && "product strengths",
      !answers.strongestOutcomes.trim() && "strongest outcomes",
      !answers.preferredLocations.trim() && "preferred locations",
      !answers.workModes.length && "work modes",
      !answers.p0Definition.trim() && "P0 definition",
      !answers.p1Definition.trim() && "P1 definition",
      !answers.p2Definition.trim() && "P2 definition",
      !answers.hardExclusions.trim() && "hard exclusions",
    ].filter((item): item is string => typeof item === "string");

    if (missing.length) {
      return {
        ok: false,
        error: `Complete these required fields: ${missing.join(", ")}.`,
      };
    }

    if (!answers.consent) {
      return {
        ok: false,
        error: "Consent is required before onboarding can be completed.",
      };
    }
  }

  return { ok: true, answers };
}

function validateResumeVariants(
  value: unknown,
  status: "draft" | "complete",
):
  | { ok: true; resumeVariants: ResumeVariant[] }
  | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RESUME_VARIANTS) {
    return {
      ok: false,
      error: `Add between 1 and ${MAX_RESUME_VARIANTS} resume variants.`,
    };
  }

  const variants: ResumeVariant[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) {
      return { ok: false, error: "Each resume variant must be an object." };
    }
    if (Object.keys(item).some((key) => !RESUME_VARIANT_KEYS.has(key))) {
      return { ok: false, error: "A resume variant contains unsupported fields." };
    }

    const limits = { id: 100, name: 200, url: 2_048, target: 1_000, emphasis: 1_000 } as const;
    for (const [field, maxLength] of Object.entries(limits) as [
      keyof typeof limits,
      number,
    ][]) {
      if (typeof item[field] !== "string" || item[field].length > maxLength) {
        return {
          ok: false,
          error: `Resume ${field} must be text under ${maxLength.toLocaleString()} characters.`,
        };
      }
    }
    if (typeof item.isDefault !== "boolean") {
      return { ok: false, error: "Resume default selection must be true or false." };
    }
    const id = item.id as string;
    const name = item.name as string;
    const url = item.url as string;
    const target = item.target as string;
    const emphasis = item.emphasis as string;
    if (!id.trim() || ids.has(id)) {
      return { ok: false, error: "Resume variants must have unique IDs." };
    }
    ids.add(id);
    const normalizedName = name.trim().toLocaleLowerCase("en-US");
    if (normalizedName && names.has(normalizedName)) {
      return { ok: false, error: "Resume variants must have unique names." };
    }
    if (normalizedName) names.add(normalizedName);

    const variant: ResumeVariant = {
      id,
      name,
      url,
      target,
      emphasis,
      isDefault: item.isDefault,
    };
    variants.push(variant);
  }

  if (status === "complete") {
    if (
      variants.some(
        (variant) => !variant.name.trim() || !isHttpsLink(variant.url.trim()),
      )
    ) {
      return {
        ok: false,
        error: "Every resume variant needs a name and a valid HTTPS link.",
      };
    }

    const defaultVariants = variants.filter((variant) => variant.isDefault);
    if (
      defaultVariants.length !== 1 ||
      !defaultVariants[0].name.trim() ||
      !isHttpsLink(defaultVariants[0].url.trim())
    ) {
      return {
        ok: false,
        error: "Choose one named default resume with a valid HTTPS link.",
      };
    }
  }

  return { ok: true, resumeVariants: variants };
}

const RESUME_VARIANT_KEYS = new Set([
  "id",
  "name",
  "url",
  "target",
  "emphasis",
  "isDefault",
]);

function isHttpsLink(value: string) {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
