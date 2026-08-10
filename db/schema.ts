import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const candidateAccess = sqliteTable(
  "candidate_access",
  {
    email: text("email").primaryKey(),
    role: text("role").notNull().default("candidate"),
    status: text("status").notNull().default("active"),
    invitedBy: text("invited_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_candidate_access_status").on(table.status)],
);

export const candidateProfiles = sqliteTable(
  "candidate_profiles",
  {
    id: text("id").primaryKey(),
    authUserId: text("auth_user_id"),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    onboardingStatus: text("onboarding_status").notNull().default("draft"),
    radarStatus: text("radar_status").notNull().default("pending"),
    answersJson: text("answers_json").notNull().default("{}"),
    answersRevision: text("answers_revision").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("idx_candidate_profiles_auth_user_id").on(table.authUserId),
    uniqueIndex("idx_candidate_profiles_email").on(table.email),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull(),
    company: text("company").notNull(),
    role: text("role").notNull(),
    location: text("location").notNull(),
    workMode: text("work_mode").notNull(),
    applyUrl: text("apply_url").notNull(),
    description: text("description").notNull(),
    fitReason: text("fit_reason").notNull(),
    tailorAdvice: text("tailor_advice").notNull(),
    resumeFit: text("resume_fit").notNull(),
    priority: text("priority").notNull(),
    priorityRank: integer("priority_rank").notNull(),
    experienceFit: text("experience_fit").notNull(),
    fundingLabel: text("funding_label").notNull(),
    fundingDetail: text("funding_detail").notNull(),
    fundingEvidence: text("funding_evidence").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    listingStatus: text("listing_status").notNull().default("open"),
    postedAt: text("posted_at"),
    lastVerifiedAt: text("last_verified_at").notNull(),
  },
  (table) => [
    index("idx_jobs_candidate_listing_first_seen").on(
      table.candidateId,
      table.listingStatus,
      table.firstSeenAt,
      table.priorityRank,
    ),
    index("idx_jobs_listing_first_seen").on(
      table.listingStatus,
      table.firstSeenAt,
      table.priorityRank,
    ),
  ],
);

export const userJobState = sqliteTable(
  "user_job_state",
  {
    userId: text("user_id").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("not-started"),
    notes: text("notes").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.jobId] }),
    index("idx_user_job_state_user_status").on(table.userId, table.status),
  ],
);
