export const JOB_STATUSES = [
  "not-started",
  "saved",
  "applied",
  "interviewing",
  "pass",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobSeed = {
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
  priority: "P0" | "P1" | "P2";
  priorityRank: number;
  experienceFit: string;
  fundingLabel: string;
  fundingDetail: string;
  fundingEvidence: "Verified" | "Inference" | "Unknown";
  firstSeenAt?: string;
  listingStatus?: "open" | "closed";
  postedAt: string | null;
  lastVerifiedAt: string;
};

/**
 * Public starter data is deliberately empty. The owner refresh console writes
 * verified, candidate-scoped roles after each person finishes onboarding.
 */
export const SEED_JOBS: JobSeed[] = [];
