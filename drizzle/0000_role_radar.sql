CREATE TABLE `candidate_access` (
  `email` text PRIMARY KEY NOT NULL,
  `role` text DEFAULT 'candidate' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `invited_by` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_candidate_access_status` ON `candidate_access` (`status`);
--> statement-breakpoint
CREATE TABLE `candidate_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `auth_user_id` text,
  `email` text NOT NULL,
  `display_name` text NOT NULL,
  `onboarding_status` text DEFAULT 'draft' NOT NULL,
  `radar_status` text DEFAULT 'pending' NOT NULL,
  `answers_json` text DEFAULT '{}' NOT NULL,
  `answers_revision` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_candidate_profiles_auth_user_id` ON `candidate_profiles` (`auth_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_candidate_profiles_email` ON `candidate_profiles` (`email`);
--> statement-breakpoint
CREATE TABLE `jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `candidate_id` text NOT NULL,
  `company` text NOT NULL,
  `role` text NOT NULL,
  `location` text NOT NULL,
  `work_mode` text NOT NULL,
  `apply_url` text NOT NULL,
  `description` text NOT NULL,
  `fit_reason` text NOT NULL,
  `tailor_advice` text NOT NULL,
  `resume_fit` text NOT NULL,
  `priority` text NOT NULL,
  `priority_rank` integer NOT NULL,
  `experience_fit` text NOT NULL,
  `funding_label` text NOT NULL,
  `funding_detail` text NOT NULL,
  `funding_evidence` text NOT NULL,
  `first_seen_at` text NOT NULL,
  `listing_status` text DEFAULT 'open' NOT NULL,
  `posted_at` text,
  `last_verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_candidate_listing_first_seen` ON `jobs` (`candidate_id`,`listing_status`,`first_seen_at`,`priority_rank`);
--> statement-breakpoint
CREATE INDEX `idx_jobs_listing_first_seen` ON `jobs` (`listing_status`,`first_seen_at`,`priority_rank`);
--> statement-breakpoint
CREATE TABLE `user_job_state` (
  `user_id` text NOT NULL,
  `job_id` text NOT NULL,
  `status` text DEFAULT 'not-started' NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`user_id`,`job_id`),
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_job_state_user_status` ON `user_job_state` (`user_id`,`status`);
