"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type CandidatePersona,
  PERSONA_LABELS,
} from "../lib/candidate-profile";

type JobStatus =
  | "not-started"
  | "saved"
  | "applied"
  | "interviewing"
  | "pass";

type PriorityTier = "P0" | "P1" | "P2";
type JobStatePatch = Partial<Pick<Job, "status" | "notes">>;

type Job = {
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
  priority: PriorityTier;
  priorityRank: number;
  experienceFit: string;
  fundingLabel: string;
  fundingDetail: string;
  fundingEvidence: "Verified" | "Inference" | "Unknown";
  firstSeenAt: string;
  listingStatus: "open" | "closed";
  postedAt: string | null;
  lastVerifiedAt: string;
  status: JobStatus;
  notes: string;
  stateUpdatedAt: string | null;
};

type ApiResponse = {
  jobs: Job[];
  meta: { latestVerifiedAt: string | null; owner: string };
};

const STATUS_OPTIONS: Array<{ value: JobStatus; label: string }> = [
  { value: "not-started", label: "Not started" },
  { value: "saved", label: "Shortlisted" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "pass", label: "Pass" },
];

const PRIORITY_OPTIONS = [
  "All priorities",
  "P0",
  "P1",
  "P2",
] as const;

function formatTime(value: string | null) {
  if (!value) return "Awaiting first research pass";
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatPostedDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function initials(company: string) {
  return company
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function companyTone(company: string) {
  const tones = ["cobalt", "mint", "amber", "rose", "violet", "slate"];
  const score = [...company].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[score % tones.length];
}

export function JobRadar({
  displayName,
  email,
  signOutUrl,
  isOwner,
  persona,
  preferredLocations,
  strengths,
}: {
  displayName: string;
  email: string;
  signOutUrl: string;
  isOwner: boolean;
  persona: CandidatePersona;
  preferredLocations: string;
  strengths: string[];
}) {
  const preferredLocationTerms = preferredLocations
    .split(/[,;\n]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const locationFilterLabel = preferredLocationTerms[0] ?? "";
  const prefersLocationFilter = Boolean(locationFilterLabel);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [latestVerifiedAt, setLatestVerifiedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITY_OPTIONS)[number]>(
    "All priorities",
  );
  const [resume, setResume] = useState("All resumes");
  const [status, setStatus] = useState<"All statuses" | JobStatus>(
    "All statuses",
  );
  const [preferredLocationOnly, setPreferredLocationOnly] = useState(false);
  const [pendingSaves, setPendingSaves] = useState<Record<string, number>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load roles");
      const data = (await response.json()) as ApiResponse;
      setJobs(data.jobs);
      setLatestVerifiedAt(data.meta.latestVerifiedAt);
    } catch {
      setLoadError("The radar could not sync. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadJobs();
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadJobs]);

  const updateLocalJob = useCallback(
    (jobId: string, patch: JobStatePatch) => {
      setJobs((current) =>
        current.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
      );
    },
    [],
  );

  const saveJob = useCallback(
    async (
      jobId: string,
      patch: JobStatePatch,
    ) => {
      setPendingSaves((current) => ({
        ...current,
        [jobId]: (current[jobId] ?? 0) + 1,
      }));
      setSaveErrors((current) => ({ ...current, [jobId]: "" }));
      try {
        const response = await fetch("/api/jobs", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, ...patch }),
        });
        if (!response.ok) throw new Error("Save failed");
      } catch {
        setSaveErrors((current) => ({
          ...current,
          [jobId]: "Not saved — retry",
        }));
      } finally {
        setPendingSaves((current) => ({
          ...current,
          [jobId]: Math.max((current[jobId] ?? 1) - 1, 0),
        }));
      }
    },
    [],
  );

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const searchable = [
        job.company,
        job.role,
        job.location,
        job.description,
        job.fitReason,
        job.resumeFit,
        job.priority,
        job.fundingLabel,
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!query || searchable.includes(query)) &&
        (priority === "All priorities" || job.priority === priority) &&
        (resume === "All resumes" || job.resumeFit === resume) &&
        (status === "All statuses" || job.status === status) &&
        (!preferredLocationOnly ||
          preferredLocationTerms.some((term) =>
            job.location.toLowerCase().includes(term),
          ))
      );
    });
  }, [
    jobs,
    search,
    priority,
    resume,
    status,
    preferredLocationOnly,
    preferredLocationTerms,
  ]);

  const resumeOptions = useMemo(
    () => [
      "All resumes",
      ...Array.from(
        new Set(
          jobs
            .map((job) => job.resumeFit.trim())
            .filter((value) => value.length > 0),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    ],
    [jobs],
  );

  const openJobs = jobs.filter((job) => job.listingStatus === "open");
  const p0Jobs = filteredJobs.filter(
    (job) => job.listingStatus === "open" && job.priority === "P0",
  );
  const p1Jobs = filteredJobs.filter(
    (job) => job.listingStatus === "open" && job.priority === "P1",
  );
  const p2Jobs = filteredJobs.filter(
    (job) => job.listingStatus === "open" && job.priority === "P2",
  );
  const archivedJobs = filteredJobs.filter(
    (job) => job.listingStatus === "closed",
  );
  const appliedCount = jobs.filter(
    (job) => job.status === "applied" || job.status === "interviewing",
  ).length;
  const interviewCount = jobs.filter(
    (job) => job.status === "interviewing",
  ).length;
  const firstName = displayName.includes("@")
    ? email.split("@")[0]
    : displayName.split(" ")[0];
  const personaLabel = PERSONA_LABELS[persona];
  const strengthSummary = strengths.slice(0, 3).join(", ");
  const todayMove = [...jobs]
    .filter(
      (job) =>
        job.listingStatus === "open" && job.priority === "P0",
    )
    .sort((left, right) => left.priorityRank - right.priorityRank)
    .slice(0, 2)
    .map((job) => job.company)
    .join(" + ");

  const clearFilters = () => {
    setSearch("");
    setPriority("All priorities");
    setResume("All resumes");
    setStatus("All statuses");
    setPreferredLocationOnly(false);
  };

  return (
    <main className="radar-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Role Radar home">
          <span className="brand-mark" aria-hidden="true">
            RR
          </span>
          <span>
            <strong>Role Radar</strong>
            <small>
              {`${firstName}’s private ${persona} job CRM`}
            </small>
          </span>
        </a>
        <div className="account-wrap">
          <span className="sync-dot" aria-hidden="true" />
          <span className="account-copy">
            <strong>{firstName}</strong>
            <small>{email}</small>
          </span>
          {isOwner ? (
            <a className="signout" href="/refresh-console">
              Research console
            </a>
          ) : null}
          <a className="signout" href={signOutUrl}>
            Sign out
          </a>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">
            {`${personaLabel} opportunities`}
          </p>
          <h1>Apply while the signal is fresh.</h1>
          <p className="hero-lede">
            {`Live ${persona} roles ranked against your private P0–P2 criteria${strengthSummary ? ` and strengths in ${strengthSummary}` : ""} — with the closest resume track and one concrete tailoring move.`}
          </p>
          <div className="research-line">
            <span className="live-pulse" aria-hidden="true" />
            <span>Latest research pass: {formatTime(latestVerifiedAt)}</span>
            <button type="button" onClick={() => void loadJobs()} disabled={loading}>
              {loading ? "Syncing…" : "Refresh view"}
            </button>
          </div>
        </div>
        <div className="hero-scorecard" aria-label="Application progress">
          <div>
            <span className="metric-value">
              {openJobs.length}
            </span>
            <span className="metric-label">open roles</span>
          </div>
          <div>
            <span className="metric-value">
              {openJobs.filter((job) => job.priority === "P0").length}
            </span>
            <span className="metric-label">P0 · act now</span>
          </div>
          <div>
            <span className="metric-value">{appliedCount}</span>
            <span className="metric-label">applications</span>
          </div>
          <div>
            <span className="metric-value">{interviewCount}</span>
            <span className="metric-label">interviews</span>
          </div>
          <div className="scorecard-note">
            <span>Today’s move</span>
            <strong>{todayMove ? `${todayMove} first` : "Review fresh matches"}</strong>
          </div>
        </div>
      </section>

      <section className="tier-guide" aria-label="Opportunity priority system">
        <button
          type="button"
          className={priority === "P0" ? "active" : ""}
          aria-pressed={priority === "P0"}
          onClick={() => setPriority(priority === "P0" ? "All priorities" : "P0")}
        >
          <span className="tier-code p0">P0</span>
          <span>
            <strong>Highest-conviction applications</strong>
            <small>Your strongest fit, freshness and/or asymmetric upside.</small>
          </span>
          <b>{openJobs.filter((job) => job.priority === "P0").length}</b>
        </button>
        <button
          type="button"
          className={priority === "P1" ? "active" : ""}
          aria-pressed={priority === "P1"}
          onClick={() => setPriority(priority === "P1" ? "All priorities" : "P1")}
        >
          <span className="tier-code p1">P1</span>
          <span>
            <strong>Strong company or role fit</strong>
            <small>Worth pursuing even without a fundraising catalyst.</small>
          </span>
          <b>{openJobs.filter((job) => job.priority === "P1").length}</b>
        </button>
        <button
          type="button"
          className={priority === "P2" ? "active" : ""}
          aria-pressed={priority === "P2"}
          onClick={() => setPriority(priority === "P2" ? "All priorities" : "P2")}
        >
          <span className="tier-code p2">P2</span>
          <span>
            <strong>Selective adjacent bets</strong>
            <small>Good companies with a role, level, or domain stretch.</small>
          </span>
          <b>{openJobs.filter((job) => job.priority === "P2").length}</b>
        </button>
      </section>

      <section className="filter-panel" aria-label="Filter opportunities">
        <label className="search-field">
          <span className="sr-only">Search roles</span>
          <span aria-hidden="true">⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search company, role, skill, or funding…"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
              ×
            </button>
          ) : null}
        </label>
        <label>
          <span className="sr-only">Priority</span>
          <select
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as (typeof PRIORITY_OPTIONS)[number])
            }
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "All priorities" ? option : `${option} priority`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Resume fit</span>
          <select
            value={resume}
            onChange={(event) =>
              setResume(event.target.value)
            }
          >
            {resumeOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Application status</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as "All statuses" | JobStatus)
            }
          >
            <option>All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {prefersLocationFilter ? (
          <label className="location-toggle">
            <input
              type="checkbox"
              checked={preferredLocationOnly}
              onChange={(event) =>
                setPreferredLocationOnly(event.target.checked)
              }
            />
            <span aria-hidden="true" />
            {locationFilterLabel} only
          </label>
        ) : null}
      </section>

      <section className="results-section" aria-live="polite">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Opportunity lanes</p>
            <h2>{p0Jobs.length + p1Jobs.length + p2Jobs.length} active matches</h2>
          </div>
          <p>
            {isOwner
              ? "P0 protects the original high-upside thesis. P1 and P2 broaden the search to excellent employers and credible stretch applications."
              : "P0 protects your highest-conviction lane. P1 and P2 cover strong fits and deliberate stretches within your stated boundaries."}
          </p>
        </div>

        {loadError ? (
          <div className="empty-state error-state">
            <strong>{loadError}</strong>
            <button type="button" onClick={() => void loadJobs()}>
              Try again
            </button>
          </div>
        ) : loading && jobs.length === 0 ? (
          <div className="loading-grid" aria-label="Loading roles">
            {[0, 1, 2].map((item) => (
              <div className="loading-card" key={item} />
            ))}
          </div>
        ) : p0Jobs.length + p1Jobs.length + p2Jobs.length === 0 ? (
          <div className="empty-state">
            <strong>No active roles match these filters.</strong>
            <span>Reset the filters to reopen all three priority lanes.</span>
            <button type="button" onClick={clearFilters}>
              Reset filters
            </button>
          </div>
        ) : (
          <div className="priority-lanes">
            <PriorityLane
              tier="P0"
              title="Apply now"
              description="Highest-conviction roles from the original fit, freshness, and upside thesis."
              jobs={p0Jobs}
              pendingSaves={pendingSaves}
              saveErrors={saveErrors}
              updateLocalJob={updateLocalJob}
              saveJob={saveJob}
            />
            <PriorityLane
              tier="P1"
              title="Strong-fit employers"
              description="Good role and company matches where learning, brand, scope, or domain fit matters more than a recent raise."
              jobs={p1Jobs}
              pendingSaves={pendingSaves}
              saveErrors={saveErrors}
              updateLocalJob={updateLocalJob}
              saveJob={saveJob}
            />
            <PriorityLane
              tier="P2"
              title="Selective stretches"
              description="Adjacent titles, experience stretches, or lower-probability bets that are still worth a deliberate application."
              jobs={p2Jobs}
              pendingSaves={pendingSaves}
              saveErrors={saveErrors}
              updateLocalJob={updateLocalJob}
              saveJob={saveJob}
            />
          </div>
        )}
      </section>

      {archivedJobs.length ? (
        <section className="watchlist-section archived-section">
          <details>
            <summary>
              <span>
                <small>Closed listings with saved history</small>
                Application archive
              </span>
              <span>{archivedJobs.length} roles</span>
            </summary>
            <div className="job-list watchlist-list">
              {archivedJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  saving={(pendingSaves[job.id] ?? 0) > 0}
                  saveError={saveErrors[job.id]}
                  updateLocalJob={updateLocalJob}
                  saveJob={saveJob}
                />
              ))}
            </div>
          </details>
        </section>
      ) : null}

      <footer>
        <p>
          This radar ranks opportunities; it never applies on your behalf.
          Confirm the role is still live before tailoring.
        </p>
        <p>
          Before accepting equity, verify grant count, fully diluted ownership,
          strike price, vesting, exercise window, and liquidation preferences.
        </p>
      </footer>
    </main>
  );
}

function PriorityLane({
  tier,
  title,
  description,
  jobs,
  pendingSaves,
  saveErrors,
  updateLocalJob,
  saveJob,
}: {
  tier: PriorityTier;
  title: string;
  description: string;
  jobs: Job[];
  pendingSaves: Record<string, number>;
  saveErrors: Record<string, string>;
  updateLocalJob: (jobId: string, patch: JobStatePatch) => void;
  saveJob: (jobId: string, patch: JobStatePatch) => Promise<void>;
}) {
  if (!jobs.length) return null;

  return (
    <section className={`priority-lane lane-${tier.toLowerCase()}`} id={tier.toLowerCase()}>
      <div className="lane-heading">
        <span className={`tier-code ${tier.toLowerCase()}`}>{tier}</span>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <b>{jobs.length} roles</b>
      </div>
      <div className="job-list">
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            saving={(pendingSaves[job.id] ?? 0) > 0}
            saveError={saveErrors[job.id]}
            updateLocalJob={updateLocalJob}
            saveJob={saveJob}
          />
        ))}
      </div>
    </section>
  );
}

function JobRow({
  job,
  saving,
  saveError,
  updateLocalJob,
  saveJob,
}: {
  job: Job;
  saving?: boolean;
  saveError?: string;
  updateLocalJob: (
    jobId: string,
    patch: JobStatePatch,
  ) => void;
  saveJob: (
    jobId: string,
    patch: JobStatePatch,
  ) => Promise<void>;
}) {
  const statusLabel = STATUS_OPTIONS.find(
    (option) => option.value === job.status,
  )?.label;

  return (
    <article className="job-card">
      <div className="job-main">
        <div className={`company-mark ${companyTone(job.company)}`} aria-hidden="true">
          {initials(job.company)}
        </div>
        <div className="job-copy">
          <div className="job-title-line">
            <div>
              <p>{job.company}</p>
              <h3>{job.role}</h3>
            </div>
            <span className={`priority-pill ${job.priority.toLowerCase()}`}>
              {job.priority}
            </span>
          </div>
          <div className="tag-row">
            <span>{job.location}</span>
            <span>{job.workMode}</span>
            <span>{job.experienceFit}</span>
            {job.postedAt ? (
              <span>Posted {formatPostedDate(job.postedAt)}</span>
            ) : null}
            <span className="fresh-tag">Added {formatTime(job.firstSeenAt)}</span>
            <span>Verified {formatTime(job.lastVerifiedAt)}</span>
          </div>
          <p className="description">{job.description}</p>
          <div className="fit-grid">
            <div>
              <span className="mini-label">Why it fits</span>
              <p>{job.fitReason}</p>
            </div>
            <div>
              <span className="mini-label">Tailor this</span>
              <p>{job.tailorAdvice}</p>
            </div>
          </div>
        </div>
      </div>

      <aside className="job-action-panel">
        <div className="resume-chip">
          <span>Resume</span>
          <strong>{job.resumeFit}</strong>
        </div>
        <div className="funding-box">
          <div>
            <span>Company / upside</span>
            <span className={`evidence ${job.fundingEvidence.toLowerCase()}`}>
              {job.fundingEvidence}
            </span>
          </div>
          <strong>{job.fundingLabel}</strong>
          <p>{job.fundingDetail}</p>
        </div>
        <div className="status-control">
          <label htmlFor={`status-${job.id}`}>Pipeline status</label>
          <select
            id={`status-${job.id}`}
            value={job.status}
            data-status={job.status}
            onChange={(event) => {
              const nextStatus = event.target.value as JobStatus;
              updateLocalJob(job.id, { status: nextStatus });
              void saveJob(job.id, { status: nextStatus });
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <details className="notes-control" open={Boolean(job.notes)}>
          <summary>{job.notes ? "Edit note" : "+ Add a note"}</summary>
          <label htmlFor={`notes-${job.id}`} className="sr-only">
            Notes for {job.company}
          </label>
          <textarea
            id={`notes-${job.id}`}
            value={job.notes}
            maxLength={4000}
            placeholder="Referral, hiring manager, deadline, next step…"
            onChange={(event) =>
              updateLocalJob(job.id, { notes: event.target.value })
            }
            onBlur={() => void saveJob(job.id, { notes: job.notes })}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </details>
        <div className="action-row">
          <span className={saveError ? "save-error" : "save-state"}>
            {saveError || (saving ? "Saving…" : `${statusLabel}`)}
          </span>
          <a href={job.applyUrl} target="_blank" rel="noreferrer">
            {job.listingStatus === "closed"
              ? "View archived listing"
              : "Open application"}{" "}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </aside>
    </article>
  );
}
