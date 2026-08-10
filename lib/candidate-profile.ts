export const ONBOARDING_SCHEMA_VERSION = 2 as const;

export const CANDIDATE_PERSONAS = ["APM", "PM", "SPM"] as const;
export type CandidatePersona = (typeof CANDIDATE_PERSONAS)[number];

export const PERSONA_LABELS: Record<CandidatePersona, string> = {
  APM: "Associate Product Manager",
  PM: "Product Manager",
  SPM: "Senior Product Manager",
};

export const TARGET_TITLES_BY_PERSONA: Record<
  CandidatePersona,
  readonly string[]
> = {
  APM: [
    "Associate Product Manager",
    "Junior Product Manager",
    "Product Manager I",
    "Product Analyst",
    "Product Operations Associate",
    "Product Operations Analyst",
    "Product Specialist",
    "Growth Analyst",
    "Associate Product Owner",
  ],
  PM: [
    "Product Manager",
    "Product Manager I",
    "Product Manager II",
    "Growth Product Manager",
    "Platform Product Manager",
    "Technical Product Manager",
    "AI Product Manager",
    "Marketplace Product Manager",
    "Product Owner",
    "Product Operations Manager",
  ],
  SPM: [
    "Senior Product Manager",
    "Lead Product Manager",
    "Product Lead",
    "Group Product Manager",
    "Principal Product Manager",
    "Senior Technical Product Manager",
    "Senior Platform Product Manager",
    "Senior Growth Product Manager",
  ],
};

export const SCOPE_OPTIONS_BY_PERSONA: Record<
  CandidatePersona,
  readonly string[]
> = {
  APM: [
    "Own a feature or bounded problem",
    "Own discovery and delivery with PM support",
    "Product analytics / experimentation",
    "Product operations / launches",
    "Cross-functional execution",
  ],
  PM: [
    "Own a product area end to end",
    "Lead without direct reports",
    "Multi-squad coordination",
    "P&L / commercial owner",
    "Platform / international mandate",
  ],
  SPM: [
    "Lead without direct reports",
    "People manager",
    "Multi-product / portfolio owner",
    "P&L / commercial owner",
    "International mandate",
  ],
};

export function isCandidatePersona(value: unknown): value is CandidatePersona {
  return (
    typeof value === "string" &&
    CANDIDATE_PERSONAS.includes(value as CandidatePersona)
  );
}

/**
 * Stable opaque revision of the canonical onboarding JSON. It is an optimistic
 * concurrency key, not an authentication primitive.
 */
export function buildAnswersRevision(value: string): string {
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    primary = Math.imul(primary ^ code, 0x01000193);
    secondary = Math.imul(secondary ^ code, 0x85ebca6b);
    secondary = (secondary << 13) | (secondary >>> 19);
  }
  return [
    "answers-v1",
    value.length.toString(36),
    (primary >>> 0).toString(36),
    (secondary >>> 0).toString(36),
  ].join("-");
}

/**
 * Schema v1 was the original senior-PM-only intake. Treating it as SPM keeps
 * those completed profiles usable while their next save upgrades them to v2.
 */
export function normalizeCandidatePersona(
  value: Record<string, unknown>,
  fallback: CandidatePersona | "" = "",
): CandidatePersona | "" {
  if (isCandidatePersona(value.persona)) return value.persona;
  if (value.schemaVersion === 1) return "SPM";
  return fallback;
}

export type RadarCandidateContext = {
  persona: CandidatePersona;
  preferredLocations: string;
  strengths: string[];
};

export function parseRadarCandidateContext(
  answersJson: string | null,
  fallbackPersona: CandidatePersona = "PM",
): RadarCandidateContext {
  try {
    const parsed: unknown = JSON.parse(answersJson || "{}");
    if (!isPlainRecord(parsed)) throw new Error("Invalid profile answers");

    const persona = normalizeCandidatePersona(parsed, fallbackPersona);
    return {
      persona: persona || fallbackPersona,
      preferredLocations:
        typeof parsed.preferredLocations === "string"
          ? parsed.preferredLocations.slice(0, 1_000)
          : "",
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths
            .filter((item): item is string => typeof item === "string")
            .slice(0, 10)
        : [],
    };
  } catch {
    return {
      persona: fallbackPersona,
      preferredLocations: "",
      strengths: [],
    };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
