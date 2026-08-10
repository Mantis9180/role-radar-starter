"use client";

import { FormEvent, ReactNode, useMemo, useRef, useState } from "react";
import {
  CANDIDATE_PERSONAS,
  type CandidatePersona,
  ONBOARDING_SCHEMA_VERSION,
  PERSONA_LABELS,
  SCOPE_OPTIONS_BY_PERSONA,
  TARGET_TITLES_BY_PERSONA,
  normalizeCandidatePersona,
} from "../lib/candidate-profile";

type CandidateProfile = {
  candidateId: string;
  email: string;
  displayName: string;
  onboardingStatus: string;
  answersJson: string | null;
  radarStatus?: string;
  isOwner: boolean;
};

type ResumeVariant = {
  id: string;
  name: string;
  url: string;
  target: string;
  emphasis: string;
  isDefault: boolean;
};

type OnboardingAnswers = {
  schemaVersion: typeof ONBOARDING_SCHEMA_VERSION;
  persona: CandidatePersona | "";
  preferredName: string;
  currentTitle: string;
  currentCompany: string;
  pmExperienceYears: string;
  targetTitles: string[];
  idealMandate: string;
  careerOutcomes: string;
  spmScopeYears: string;
  scopeLevels: string[];
  strengths: string[];
  strongestOutcomes: string;
  leadershipScope: string;
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
  p0Definition: string;
  p1Definition: string;
  p2Definition: string;
  hardExclusions: string;
  p0Examples: string;
  p1Examples: string;
  p2Examples: string;
  resumeVariants: ResumeVariant[];
  tailoringNotes: string;
  consent: boolean;
};

const STEPS = [
  { label: "Goals", detail: "Your next move" },
  { label: "Scope & strengths", detail: "Your product evidence" },
  { label: "Constraints", detail: "Company and practical fit" },
  { label: "Priority model", detail: "Define P0, P1 and P2" },
  { label: "Resume tracks", detail: "Route each application" },
  { label: "Review", detail: "Confirm and submit" },
] as const;

const STRENGTH_OPTIONS = [
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
];

const WORK_MODE_OPTIONS = [
  "Hybrid",
  "Remote",
  "On-site",
  "Relocation",
  "Global remote",
];

const COMPANY_STAGE_OPTIONS = [
  "Seed–Series A",
  "Series B–C",
  "Late-stage private",
  "Profitable scale-up",
  "Public / large company",
];

const EMPTY_ANSWERS: OnboardingAnswers = {
  schemaVersion: ONBOARDING_SCHEMA_VERSION,
  persona: "",
  preferredName: "",
  currentTitle: "",
  currentCompany: "",
  pmExperienceYears: "",
  targetTitles: [],
  idealMandate: "",
  careerOutcomes: "",
  spmScopeYears: "",
  scopeLevels: [],
  strengths: [],
  strongestOutcomes: "",
  leadershipScope: "",
  currentLocation: "",
  noticePeriod: "",
  earliestStart: "",
  preferredLocations: "",
  workModes: [],
  companyStages: [],
  preferredDomains: "",
  minimumFixed: "",
  compensationNotes: "",
  equityPreference: "Case-by-case",
  companyExclusions: "",
  p0Definition: "",
  p1Definition: "",
  p2Definition: "",
  hardExclusions: "",
  p0Examples: "",
  p1Examples: "",
  p2Examples: "",
  resumeVariants: [
    {
      id: "resume-1",
      name: "Master resume",
      url: "",
      target: "",
      emphasis: "",
      isDefault: true,
    },
  ],
  tailoringNotes: "",
  consent: false,
};

function parseAnswers(value: string | null): OnboardingAnswers {
  if (!value) return freshEmptyAnswers();

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isPlainRecord(parsed)) return freshEmptyAnswers();
    const persona = normalizeCandidatePersona(parsed);

    return {
      schemaVersion: ONBOARDING_SCHEMA_VERSION,
      persona,
      preferredName: sanitizeString(parsed.preferredName, 120),
      currentTitle: sanitizeString(parsed.currentTitle, 200),
      currentCompany: sanitizeString(parsed.currentCompany, 200),
      pmExperienceYears: sanitizeString(parsed.pmExperienceYears, 100),
      targetTitles: sanitizeSelectionList(
        parsed.targetTitles,
        persona ? TARGET_TITLES_BY_PERSONA[persona] : [],
        6,
      ),
      idealMandate: sanitizeString(parsed.idealMandate, 4_000),
      careerOutcomes: sanitizeString(parsed.careerOutcomes, 1_000),
      spmScopeYears: sanitizeString(parsed.spmScopeYears, 100),
      scopeLevels: sanitizeSelectionList(
        parsed.scopeLevels,
        persona ? SCOPE_OPTIONS_BY_PERSONA[persona] : [],
        5,
      ),
      strengths: sanitizeSelectionList(parsed.strengths, STRENGTH_OPTIONS, 10),
      strongestOutcomes: sanitizeString(parsed.strongestOutcomes, 8_000),
      leadershipScope: sanitizeString(parsed.leadershipScope, 1_000),
      currentLocation: sanitizeString(parsed.currentLocation, 300),
      noticePeriod: sanitizeString(parsed.noticePeriod, 200),
      earliestStart: sanitizeDate(parsed.earliestStart),
      preferredLocations: sanitizeString(parsed.preferredLocations, 1_000),
      workModes: sanitizeSelectionList(parsed.workModes, WORK_MODE_OPTIONS, 5),
      companyStages: sanitizeSelectionList(
        parsed.companyStages,
        COMPANY_STAGE_OPTIONS,
        5,
      ),
      preferredDomains: sanitizeString(parsed.preferredDomains, 1_000),
      minimumFixed: sanitizeString(parsed.minimumFixed, 200),
      compensationNotes: sanitizeString(parsed.compensationNotes, 2_000),
      equityPreference: sanitizeEquityPreference(parsed.equityPreference),
      companyExclusions: sanitizeString(parsed.companyExclusions, 4_000),
      p0Definition: sanitizeString(parsed.p0Definition, 4_000),
      p1Definition: sanitizeString(parsed.p1Definition, 4_000),
      p2Definition: sanitizeString(parsed.p2Definition, 4_000),
      hardExclusions: sanitizeString(parsed.hardExclusions, 4_000),
      p0Examples: sanitizeString(parsed.p0Examples, 4_000),
      p1Examples: sanitizeString(parsed.p1Examples, 4_000),
      p2Examples: sanitizeString(parsed.p2Examples, 4_000),
      resumeVariants: sanitizeResumeVariants(parsed.resumeVariants),
      tailoringNotes: sanitizeString(parsed.tailoringNotes, 4_000),
      consent: parsed.consent === true,
    };
  } catch {
    return freshEmptyAnswers();
  }
}

function freshEmptyAnswers(): OnboardingAnswers {
  return {
    ...EMPTY_ANSWERS,
    targetTitles: [],
    scopeLevels: [],
    strengths: [],
    workModes: [],
    companyStages: [],
    resumeVariants: EMPTY_ANSWERS.resumeVariants.map((variant) => ({
      ...variant,
    })),
  };
}

function sanitizeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function sanitizeSelectionList(
  value: unknown,
  allowedValues: readonly string[],
  maxItems: number,
) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(allowedValues);
  const sanitized: string[] = [];
  for (const item of value) {
    if (
      typeof item === "string" &&
      allowed.has(item) &&
      !sanitized.includes(item)
    ) {
      sanitized.push(item);
      if (sanitized.length === maxItems) break;
    }
  }
  return sanitized;
}

function sanitizeDate(value: unknown) {
  const date = sanitizeString(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : "";
}

function sanitizeEquityPreference(value: unknown) {
  const allowed = ["Required", "Preferred", "Case-by-case", "Not important"];
  return typeof value === "string" && allowed.includes(value)
    ? value
    : "Case-by-case";
}

function sanitizeResumeVariants(value: unknown): ResumeVariant[] {
  if (!Array.isArray(value)) {
    return freshDefaultResumeVariant();
  }

  const variants: ResumeVariant[] = [];
  const ids = new Set<string>();
  for (const [index, item] of value.slice(0, 6).entries()) {
    if (!isPlainRecord(item)) continue;

    const rawId = sanitizeString(item.id, 100)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-");
    let id = rawId || `resume-${index + 1}`;
    let suffix = 2;
    while (ids.has(id)) {
      id = `resume-${index + 1}-${suffix}`;
      suffix += 1;
    }
    ids.add(id);

    variants.push({
      id,
      name: sanitizeString(item.name, 200),
      url: sanitizeString(item.url, 2_048),
      target: sanitizeString(item.target, 1_000),
      emphasis: sanitizeString(item.emphasis, 1_000),
      isDefault: item.isDefault === true,
    });
  }

  if (!variants.length) return freshDefaultResumeVariant();

  const selectedDefault = variants.findIndex((variant) => variant.isDefault);
  const defaultIndex = selectedDefault >= 0 ? selectedDefault : 0;
  return variants.map((variant, index) => ({
    ...variant,
    isDefault: index === defaultIndex,
  }));
}

function freshDefaultResumeVariant() {
  return EMPTY_ANSWERS.resumeVariants.map((variant) => ({ ...variant }));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toggleList(current: string[], value: string, maxItems = Infinity) {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : current.length < maxItems
      ? [...current, value]
      : current;
}

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

export function CandidateOnboarding({
  profile,
  signOutUrl,
}: {
  profile: CandidateProfile;
  signOutUrl: string;
}) {
  const [answers, setAnswers] = useState<OnboardingAnswers>(() =>
    parseAnswers(profile.answersJson),
  );
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(
    profile.onboardingStatus === "complete",
  );
  const [saveNote, setSaveNote] = useState("");
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const firstName =
    answers.preferredName.trim() ||
    (profile.displayName.includes("@")
      ? "there"
      : profile.displayName.split(" ")[0]);
  const personaLabel = answers.persona
    ? PERSONA_LABELS[answers.persona]
    : "product";

  const update = <K extends keyof OnboardingAnswers>(
    key: K,
    value: OnboardingAnswers[K],
  ) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setError("");
    setSaveNote("");
  };

  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  const requiredMissing = useMemo(() => validateStep(step, answers), [step, answers]);

  const persist = async (status: "draft" | "complete") => {
    setSaving(true);
    setError("");
    setSaveNote("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          onboardingStatus: status,
          answersJson: JSON.stringify(answers),
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "We couldn’t save this just now. Please try again.",
        );
      }
      setSaveNote(status === "draft" ? "Progress saved" : "Profile submitted");
      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "We couldn’t save this just now. Please try again.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const moveToStep = (nextStep: number) => {
    setStep(nextStep);
    setError("");
    setSaveNote("");
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const handleContinue = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateStep(step, answers);
    if (validation) {
      setError(validation);
      headingRef.current?.focus();
      return;
    }

    if (step < STEPS.length - 1) {
      if (await persist("draft")) moveToStep(step + 1);
      return;
    }

    if (await persist("complete")) setCompleted(true);
  };

  const saveDraft = async () => {
    await persist("draft");
  };

  if (completed) {
    return (
      <main className="onboarding-shell">
        <OnboardingHeader
          email={profile.email}
          name={firstName}
          signOutUrl={signOutUrl}
        />
        <section className="onboarding-complete" aria-labelledby="complete-title">
          <span className="complete-mark" aria-hidden="true">✓</span>
          <p className="eyebrow">{personaLabel} profile received</p>
          <h1 id="complete-title">Your radar is being calibrated.</h1>
          <p className="complete-lede">
            Thanks, {firstName}. Your goals, priority rules and resume tracks are
            ready for review. Your private {personaLabel} radar will open after
            its first calibration pass.
          </p>
          <div className="complete-next" aria-label="What happens next">
            <div>
              <span>01</span>
              <strong>Profile review</strong>
              <p>We check that your P0, P1 and P2 rules are specific enough to rank confidently.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Resume mapping</strong>
              <p>Each role is paired with the closest resume track and one concrete tailoring move.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Radar activation</strong>
              <p>Fresh {answers.persona || "product"} opportunities appear in your account without mixing with another candidate’s data.</p>
            </div>
          </div>
          <div className="complete-actions">
            <button
              className="button-secondary"
              type="button"
              onClick={() => {
                setCompleted(false);
                moveToStep(0);
              }}
            >
              Edit profile
            </button>
            <a className="button-quiet" href={signOutUrl}>Sign out</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding-shell">
      <OnboardingHeader
        email={profile.email}
        name={firstName}
        signOutUrl={signOutUrl}
      />

      <div className="onboarding-layout">
        <aside className="onboarding-rail" aria-label="Onboarding progress">
          <div>
            <p className="eyebrow">{answers.persona ? `${answers.persona} calibration` : "Product-role calibration"}</p>
            <h1>Shape the search around your ambition.</h1>
            <p>
              Six focused steps turn your experience and preferences into a
              role-ranking model that is actually yours.
            </p>
          </div>

          <div className="mobile-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>

          <ol className="onboarding-steps">
            {STEPS.map((item, index) => (
              <li
                key={item.label}
                className={index < step ? "complete" : index === step ? "active" : ""}
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? "✓" : index + 1}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
              </li>
            ))}
          </ol>

          <div className="privacy-note">
            <span aria-hidden="true">●</span>
            <p>
              Your application status and notes stay out of the research
              console. The owner can review your profile criteria and resume
              links, and the D1 operator can access stored data. Never share
              passwords, verification codes or restricted credentials.
            </p>
          </div>
        </aside>

        <form className="onboarding-panel" onSubmit={handleContinue} noValidate>
          <div className="step-kicker">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span>{progress}% complete</span>
          </div>

          <StepHeader step={step} persona={answers.persona} headingRef={headingRef} />

          <div className="step-fields">
            {step === 0 ? <GoalsStep answers={answers} update={update} /> : null}
            {step === 1 ? <ScopeStep answers={answers} update={update} /> : null}
            {step === 2 ? <ConstraintsStep answers={answers} update={update} /> : null}
            {step === 3 ? <PriorityStep answers={answers} update={update} /> : null}
            {step === 4 ? <ResumeStep answers={answers} update={update} /> : null}
            {step === 5 ? <ReviewStep answers={answers} update={update} email={profile.email} /> : null}
          </div>

          <div className="form-feedback" aria-live="polite">
            {error ? <p className="form-error">{error}</p> : null}
            {!error && saveNote ? <p className="form-saved">✓ {saveNote}</p> : null}
            {!error && !saveNote && requiredMissing ? (
              <p className="required-note"><span aria-hidden="true">*</span> Required fields are marked</p>
            ) : null}
          </div>

          <div className="onboarding-actions">
            <div>
              {step > 0 ? (
                <button
                  className="button-quiet"
                  type="button"
                  onClick={() => moveToStep(step - 1)}
                  disabled={saving}
                >
                  ← Back
                </button>
              ) : null}
              <button
                className="button-quiet save-draft"
                type="button"
                onClick={() => void saveDraft()}
                disabled={saving}
              >
                Save progress
              </button>
            </div>
            <button className="button-primary" type="submit" disabled={saving}>
              {saving
                ? "Saving…"
                : step === STEPS.length - 1
                  ? "Submit profile"
                  : "Save & continue →"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function OnboardingHeader({
  email,
  name,
  signOutUrl,
}: {
  email: string;
  name: string;
  signOutUrl: string;
}) {
  return (
    <header className="onboarding-topbar">
      <span className="brand" aria-label="Role Radar">
        <span className="brand-mark" aria-hidden="true">RR</span>
        <span>
          <strong>Role Radar</strong>
          <small>Private product opportunity intelligence</small>
        </span>
      </span>
      <div className="account-wrap">
        <span className="sync-dot" aria-hidden="true" />
        <span className="account-copy">
          <strong>{name}</strong>
          <small>{email}</small>
        </span>
        <a className="signout" href={signOutUrl}>Sign out</a>
      </div>
    </header>
  );
}

function StepHeader({
  step,
  persona,
  headingRef,
}: {
  step: number;
  persona: CandidatePersona | "";
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const targetLevel = persona || "target-role";
  const copy = [
    ["Start with the move you want.", "We’ll use this to decide which titles and mandates enter your radar."],
    [`Show us your ${targetLevel}-level signal.`, "Scope and outcomes matter more than title alone. Use evidence that a hiring manager can understand."],
    ["Set the practical boundaries.", "Good recommendations respect location, timing, compensation and company-stage preferences."],
    ["Teach the radar your priorities.", "Define the difference between apply-now, strong-fit and selective-stretch opportunities."],
    ["Map your resume portfolio.", "Add view-only links. We’ll recommend the closest version for each role and flag the exact tweak."],
    ["Review your calibration brief.", "Confirm the essentials before your profile goes into the first research pass."],
  ][step];

  return (
    <header className="onboarding-step-header">
      <h2 ref={headingRef} tabIndex={-1}>{copy[0]}</h2>
      <p>{copy[1]}</p>
    </header>
  );
}

type UpdateAnswers = <K extends keyof OnboardingAnswers>(
  key: K,
  value: OnboardingAnswers[K],
) => void;

function GoalsStep({ answers, update }: { answers: OnboardingAnswers; update: UpdateAnswers }) {
  const targetTitles = answers.persona
    ? TARGET_TITLES_BY_PERSONA[answers.persona]
    : [];

  return (
    <>
      <Fieldset
        label="Which product-career persona should this radar use?"
        required
        hint="Choose the level you are applying for now. It controls role discovery, fit thresholds and title options."
      >
        <PersonaChoiceGrid
          selected={answers.persona}
          onSelect={(persona) => {
            update("persona", persona);
            update("targetTitles", []);
            update("scopeLevels", []);
          }}
        />
      </Fieldset>

      <div className="field-grid three-up">
        <Field label="Preferred name" htmlFor="preferred-name">
          <input id="preferred-name" value={answers.preferredName} onChange={(e) => update("preferredName", e.target.value)} placeholder="What should we call you?" />
        </Field>
        <Field label="Current title" htmlFor="current-title">
          <input id="current-title" value={answers.currentTitle} onChange={(e) => update("currentTitle", e.target.value)} placeholder="e.g. Product Manager" />
        </Field>
        <Field label="Current company" htmlFor="current-company">
          <input id="current-company" value={answers.currentCompany} onChange={(e) => update("currentCompany", e.target.value)} placeholder="Company or independent" />
        </Field>
      </div>

      <Fieldset label="Which titles should we search?" required hint="Select up to six titles you would genuinely consider.">
        <ChoiceGrid
          values={targetTitles}
          selected={answers.targetTitles}
          onToggle={(value) => update("targetTitles", toggleList(answers.targetTitles, value, 6))}
        />
        {!answers.persona ? (
          <p className="selection-prompt">Choose APM, PM or SPM to see the matching title set.</p>
        ) : null}
      </Fieldset>

      <Field label="Describe your ideal next mandate" htmlFor="ideal-mandate" required hint="Include product, users, business model, ownership and the decisions you want to lead.">
        <textarea id="ideal-mandate" value={answers.idealMandate} onChange={(e) => update("idealMandate", e.target.value)} rows={5} placeholder="I want to own…" />
      </Field>

      <div className="field-grid">
        <Field label="Total PM experience" htmlFor="pm-years" hint="Years and months is fine.">
          <input id="pm-years" value={answers.pmExperienceYears} onChange={(e) => update("pmExperienceYears", e.target.value)} placeholder="e.g. 7 years 6 months" />
        </Field>
        <Field label="Top outcomes from this move" htmlFor="career-outcomes" hint="Pick and rank what matters: scope, compensation, leadership, equity, brand, balance…">
          <input id="career-outcomes" value={answers.careerOutcomes} onChange={(e) => update("careerOutcomes", e.target.value)} placeholder="1. Scope  2. Leadership  3. Equity" />
        </Field>
      </div>
    </>
  );
}

function ScopeStep({ answers, update }: { answers: OnboardingAnswers; update: UpdateAnswers }) {
  const targetLevel = answers.persona || "target";
  const scopeOptions = answers.persona
    ? SCOPE_OPTIONS_BY_PERSONA[answers.persona]
    : [];

  return (
    <>
      <div className="field-grid">
        <Field label={`${targetLevel}-level scope experience`} htmlFor="spm-years" hint="Time spent operating at this scope, regardless of title.">
          <input id="spm-years" value={answers.spmScopeYears} onChange={(e) => update("spmScopeYears", e.target.value)} placeholder="e.g. 3 years" />
        </Field>
        <Field label="Leadership footprint" htmlFor="leadership-scope" hint="Direct reports, squads, functions and senior stakeholders.">
          <input id="leadership-scope" value={answers.leadershipScope} onChange={(e) => update("leadershipScope", e.target.value)} placeholder="e.g. 2 squads, 14 XFN partners, VP sponsor" />
        </Field>
      </div>

      <Fieldset label="Minimum scope you want next" required>
        <ChoiceGrid values={scopeOptions} selected={answers.scopeLevels} onToggle={(value) => update("scopeLevels", toggleList(answers.scopeLevels, value))} />
      </Fieldset>

      <Fieldset label="Your strongest product lanes" required hint="Choose the capabilities you can defend with clear evidence.">
        <ChoiceGrid values={STRENGTH_OPTIONS} selected={answers.strengths} onToggle={(value) => update("strengths", toggleList(answers.strengths, value))} />
      </Fieldset>

      <Field label="Your three strongest outcomes" htmlFor="strongest-outcomes" required hint="Use: problem → your ownership → quantified result → timeframe. Keep confidential claims out.">
        <textarea id="strongest-outcomes" value={answers.strongestOutcomes} onChange={(e) => update("strongestOutcomes", e.target.value)} rows={7} placeholder={"1. …\n2. …\n3. …"} />
      </Field>
    </>
  );
}

function ConstraintsStep({ answers, update }: { answers: OnboardingAnswers; update: UpdateAnswers }) {
  return (
    <>
      <div className="field-grid three-up">
        <Field label="Current location" htmlFor="current-location">
          <input id="current-location" value={answers.currentLocation} onChange={(e) => update("currentLocation", e.target.value)} placeholder="City, country" />
        </Field>
        <Field label="Notice period" htmlFor="notice-period">
          <input id="notice-period" value={answers.noticePeriod} onChange={(e) => update("noticePeriod", e.target.value)} placeholder="e.g. 30 days" />
        </Field>
        <Field label="Earliest start" htmlFor="earliest-start">
          <input id="earliest-start" type="date" value={answers.earliestStart} onChange={(e) => update("earliestStart", e.target.value)} />
        </Field>
      </div>

      <Field label="Preferred and acceptable locations" htmlFor="preferred-locations" required hint="Separate preferred from acceptable; mention commute or relocation limits.">
        <input id="preferred-locations" value={answers.preferredLocations} onChange={(e) => update("preferredLocations", e.target.value)} placeholder="Preferred: city or region. Acceptable: remote…" />
      </Field>

      <Fieldset label="Work modes you would accept" required>
        <ChoiceGrid values={WORK_MODE_OPTIONS} selected={answers.workModes} onToggle={(value) => update("workModes", toggleList(answers.workModes, value))} />
      </Fieldset>

      <Fieldset label="Company stages worth considering" hint="Leave a stage unchecked if you do not want it surfaced.">
        <ChoiceGrid values={COMPANY_STAGE_OPTIONS} selected={answers.companyStages} onToggle={(value) => update("companyStages", toggleList(answers.companyStages, value))} />
      </Fieldset>

      <div className="field-grid">
        <Field label="Preferred domains" htmlFor="preferred-domains" hint="List and rank up to five.">
          <input id="preferred-domains" value={answers.preferredDomains} onChange={(e) => update("preferredDomains", e.target.value)} placeholder="B2B SaaS, fintech, AI…" />
        </Field>
        <Field label="Minimum fixed compensation" htmlFor="minimum-fixed" hint="Currency and annual basis; you may write Private.">
          <input id="minimum-fixed" value={answers.minimumFixed} onChange={(e) => update("minimumFixed", e.target.value)} placeholder="e.g. 120,000 annual base in local currency" />
        </Field>
      </div>

      <div className="field-grid">
        <Field label="Equity preference" htmlFor="equity-preference">
          <select id="equity-preference" value={answers.equityPreference} onChange={(e) => update("equityPreference", e.target.value)}>
            <option>Required</option>
            <option>Preferred</option>
            <option>Case-by-case</option>
            <option>Not important</option>
          </select>
        </Field>
        <Field label="Compensation trade-offs" htmlFor="comp-notes" hint="Cash vs equity, title vs scope, or exceptional-company exceptions.">
          <input id="comp-notes" value={answers.compensationNotes} onChange={(e) => update("compensationNotes", e.target.value)} placeholder="I would trade…" />
        </Field>
      </div>

      <Field label="Companies or domains to exclude" htmlFor="company-exclusions" hint="Optional here; hard exclusions are confirmed in the next step.">
        <textarea id="company-exclusions" value={answers.companyExclusions} onChange={(e) => update("companyExclusions", e.target.value)} rows={3} placeholder="Do not surface…" />
      </Field>
    </>
  );
}

function PriorityStep({ answers, update }: { answers: OnboardingAnswers; update: UpdateAnswers }) {
  return (
    <>
      <div className="priority-explainer">
        <div className="p0"><span>P0</span><strong>Apply now</strong><p>Exceptional fit, urgency or asymmetric upside. Protect this lane.</p></div>
        <div className="p1"><span>P1</span><strong>Strong fit</strong><p>Credible scope and company value, with acceptable compromises.</p></div>
        <div className="p2"><span>P2</span><strong>Selective stretch</strong><p>A meaningful gap, justified by enough transferable upside.</p></div>
      </div>

      <Field label="A role is P0 for me only when…" htmlFor="p0-definition" required hint="List 3–6 conditions. Include scope, company, location and experience match.">
        <textarea id="p0-definition" value={answers.p0Definition} onChange={(e) => update("p0Definition", e.target.value)} rows={5} placeholder="P0 requires…" />
      </Field>
      <Field label="A role is P1 when…" htmlFor="p1-definition" required hint="Name the compromises that are still acceptable.">
        <textarea id="p1-definition" value={answers.p1Definition} onChange={(e) => update("p1Definition", e.target.value)} rows={4} placeholder="P1 is still worthwhile when…" />
      </Field>
      <Field label="A P2 role is worth showing only when…" htmlFor="p2-definition" required hint="Define the upside that justifies title, tenure, domain or location stretch.">
        <textarea id="p2-definition" value={answers.p2Definition} onChange={(e) => update("p2Definition", e.target.value)} rows={4} placeholder="Show a stretch only if…" />
      </Field>
      <Field label="Hard exclusions across every tier" htmlFor="hard-exclusions" required hint="Cover ethics, role type, compensation, location, travel, schedule and culture.">
        <textarea id="hard-exclusions" value={answers.hardExclusions} onChange={(e) => update("hardExclusions", e.target.value)} rows={4} placeholder="Never show…" />
      </Field>

      <div className="calibration-box">
        <div>
          <strong>Optional but powerful: calibration examples</strong>
          <p>Paste one or two recent role links per tier. Add a short “why” after each link.</p>
        </div>
        <div className="field-grid three-up">
          <Field label="Clear P0 examples" htmlFor="p0-examples"><textarea id="p0-examples" value={answers.p0Examples} onChange={(e) => update("p0Examples", e.target.value)} rows={3} placeholder="URL — why P0" /></Field>
          <Field label="Clear P1 examples" htmlFor="p1-examples"><textarea id="p1-examples" value={answers.p1Examples} onChange={(e) => update("p1Examples", e.target.value)} rows={3} placeholder="URL — why P1" /></Field>
          <Field label="Clear P2 examples" htmlFor="p2-examples"><textarea id="p2-examples" value={answers.p2Examples} onChange={(e) => update("p2Examples", e.target.value)} rows={3} placeholder="URL — why P2" /></Field>
        </div>
      </div>
    </>
  );
}

function ResumeStep({ answers, update }: { answers: OnboardingAnswers; update: UpdateAnswers }) {
  const updateVariant = (id: string, patch: Partial<ResumeVariant>) => {
    update(
      "resumeVariants",
      answers.resumeVariants.map((variant) =>
        variant.id === id ? { ...variant, ...patch } : variant,
      ),
    );
  };

  const chooseDefault = (id: string) => {
    update(
      "resumeVariants",
      answers.resumeVariants.map((variant) => ({
        ...variant,
        isDefault: variant.id === id,
      })),
    );
  };

  return (
    <>
      <div className="link-safety-note">
        <span aria-hidden="true">↗</span>
        <div>
          <strong>Use a view-only HTTPS link</strong>
          <p>Google Drive, Dropbox, Notion or a portfolio URL works. Test access in a private window. Do not add a password or restricted credential.</p>
        </div>
      </div>

      <div className="resume-variants">
        {answers.resumeVariants.map((variant, index) => (
          <section className="resume-variant" key={variant.id} aria-labelledby={`${variant.id}-title`}>
            <div className="resume-variant-heading">
              <div>
                <span>Resume {index + 1}</span>
                <h3 id={`${variant.id}-title`}>{variant.name || "Untitled resume"}</h3>
              </div>
              <label className="default-radio">
                <input type="radio" name="default-resume" checked={variant.isDefault} onChange={() => chooseDefault(variant.id)} />
                Default
              </label>
              {answers.resumeVariants.length > 1 ? (
                <button
                  className="remove-variant"
                  type="button"
                  onClick={() => {
                    const remaining = answers.resumeVariants.filter((item) => item.id !== variant.id);
                    if (variant.isDefault && remaining[0]) remaining[0] = { ...remaining[0], isDefault: true };
                    update("resumeVariants", remaining);
                  }}
                  aria-label={`Remove ${variant.name || `resume ${index + 1}`}`}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <div className="field-grid">
              <Field label="Variant name" htmlFor={`${variant.id}-name`} required>
                <input id={`${variant.id}-name`} value={variant.name} onChange={(e) => updateVariant(variant.id, { name: e.target.value })} placeholder="e.g. B2B SaaS & Platform" />
              </Field>
              <Field label="View-only link" htmlFor={`${variant.id}-url`} required>
                <input
                  id={`${variant.id}-url`}
                  type="url"
                  inputMode="url"
                  pattern="https://.*"
                  maxLength={2_048}
                  title="Enter a valid HTTPS link"
                  value={variant.url}
                  onChange={(e) =>
                    updateVariant(variant.id, { url: e.target.value })
                  }
                  placeholder="https://…"
                />
              </Field>
            </div>
            <div className="field-grid">
              <Field label="Best-fit roles and companies" htmlFor={`${variant.id}-target`}>
                <input id={`${variant.id}-target`} value={variant.target} onChange={(e) => updateVariant(variant.id, { target: e.target.value })} placeholder={`${answers.persona || "PM"} · B2B SaaS · Series B+`} />
              </Field>
              <Field label="Themes emphasised" htmlFor={`${variant.id}-emphasis`}>
                <input id={`${variant.id}-emphasis`} value={variant.emphasis} onChange={(e) => updateVariant(variant.id, { emphasis: e.target.value })} placeholder="Platform, monetisation, leadership" />
              </Field>
            </div>
          </section>
        ))}
      </div>

      <button
        className="add-variant"
        type="button"
        disabled={answers.resumeVariants.length >= 6}
        onClick={() =>
          update("resumeVariants", [
            ...answers.resumeVariants,
            {
              id: `resume-${Date.now()}`,
              name: "",
              url: "",
              target: "",
              emphasis: "",
              isDefault: false,
            },
          ])
        }
      >
        {answers.resumeVariants.length >= 6
          ? "Maximum of 6 resume tracks"
          : "+ Add another resume track"}
      </button>

      <Field label="Tailoring boundaries" htmlFor="tailoring-notes" hint="What may be rewritten, reordered or omitted? What must always remain?">
        <textarea id="tailoring-notes" value={answers.tailoringNotes} onChange={(e) => update("tailoringNotes", e.target.value)} rows={4} placeholder="Keep to two pages; metrics may be selected per role; never…" />
      </Field>
    </>
  );
}

function ReviewStep({
  answers,
  update,
  email,
}: {
  answers: OnboardingAnswers;
  update: UpdateAnswers;
  email: string;
}) {
  const defaultResume = answers.resumeVariants.find((variant) => variant.isDefault);
  return (
    <>
      <div className="review-grid">
        <ReviewCard label="Persona" title={answers.persona ? PERSONA_LABELS[answers.persona] : "Not specified"}>
          <TagList values={answers.targetTitles} />
        </ReviewCard>
        <ReviewCard label="Target mandate" title={answers.targetTitles.join(" · ")}>
          <p>{answers.idealMandate}</p>
        </ReviewCard>
        <ReviewCard label="Product scope" title={answers.scopeLevels.join(" · ")}>
          <TagList values={answers.strengths} />
        </ReviewCard>
        <ReviewCard label="Search boundary" title={answers.preferredLocations}>
          <TagList values={answers.workModes} />
        </ReviewCard>
        <ReviewCard label="Resume routing" title={`${answers.resumeVariants.length} version${answers.resumeVariants.length === 1 ? "" : "s"}`}>
          <p>Default: {defaultResume?.name || "Not selected"}</p>
        </ReviewCard>
      </div>

      <div className="tier-review">
        <div><span className="tier-code p0">P0</span><p>{answers.p0Definition}</p></div>
        <div><span className="tier-code p1">P1</span><p>{answers.p1Definition}</p></div>
        <div><span className="tier-code p2">P2</span><p>{answers.p2Definition}</p></div>
      </div>

      <div className="consent-card">
        <label>
          <input type="checkbox" checked={answers.consent} onChange={(e) => update("consent", e.target.checked)} />
          <span aria-hidden="true" />
          <strong>I consent to private profile storage and calibration.</strong>
        </label>
        <p>
          Role Radar stores these preferences, resume links, fit labels,
          application status and notes under <strong>{email}</strong>. The
          owner/operator can access your profile criteria and resume links to
          run research refreshes, while application status and notes are
          excluded from the refresh console. The D1 database operator may
          access all stored data for administration. The app will not apply to
          roles on your behalf. Ask the operator to correct or delete your
          profile if your criteria change.
        </p>
      </div>
    </>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="onboarding-field">
      <label htmlFor={htmlFor}>
        {label} {required ? <span aria-label="required">*</span> : null}
      </label>
      {hint ? <small>{hint}</small> : null}
      {children}
    </div>
  );
}

function Fieldset({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="onboarding-fieldset">
      <legend>
        {label} {required ? <span aria-label="required">*</span> : null}
      </legend>
      {hint ? <small>{hint}</small> : null}
      {children}
    </fieldset>
  );
}

function ChoiceGrid({
  values,
  selected,
  onToggle,
}: {
  values: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="choice-grid">
      {values.map((value) => (
        <label key={value} className={selected.includes(value) ? "selected" : ""}>
          <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
          <span aria-hidden="true">{selected.includes(value) ? "✓" : ""}</span>
          {value}
        </label>
      ))}
    </div>
  );
}

const PERSONA_DESCRIPTIONS: Record<CandidatePersona, string> = {
  APM: "Early-career ownership, product analysis and product operations",
  PM: "End-to-end product ownership across discovery, delivery and outcomes",
  SPM: "Senior scope, strategy, leadership and multi-team influence",
};

function PersonaChoiceGrid({
  selected,
  onSelect,
}: {
  selected: CandidatePersona | "";
  onSelect: (persona: CandidatePersona) => void;
}) {
  return (
    <div className="persona-grid">
      {CANDIDATE_PERSONAS.map((persona) => (
        <label key={persona} className={selected === persona ? "selected" : ""}>
          <input
            type="radio"
            name="candidate-persona"
            checked={selected === persona}
            onChange={() => onSelect(persona)}
          />
          <span className="persona-code">{persona}</span>
          <span>
            <strong>{PERSONA_LABELS[persona]}</strong>
            <small>{PERSONA_DESCRIPTIONS[persona]}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

function ReviewCard({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="review-card">
      <span>{label}</span>
      <h3>{title || "Not specified"}</h3>
      {children}
    </section>
  );
}

function TagList({ values }: { values: string[] }) {
  return <div className="review-tags">{values.map((value) => <span key={value}>{value}</span>)}</div>;
}

function validateStep(step: number, answers: OnboardingAnswers) {
  if (
    step === 0 &&
    (!answers.persona ||
      !answers.targetTitles.length ||
      !answers.idealMandate.trim())
  ) {
    return "Choose your APM, PM or SPM persona, at least one target title, and describe your ideal mandate.";
  }
  if (
    step === 1 &&
    (!answers.scopeLevels.length ||
      !answers.strengths.length ||
      !answers.strongestOutcomes.trim())
  ) {
    return "Choose your target scope and strengths, then add your strongest outcomes.";
  }
  if (step === 2 && (!answers.preferredLocations.trim() || !answers.workModes.length)) {
    return "Add your preferred locations and choose at least one acceptable work mode.";
  }
  if (
    step === 3 &&
    (!answers.p0Definition.trim() ||
      !answers.p1Definition.trim() ||
      !answers.p2Definition.trim() ||
      !answers.hardExclusions.trim())
  ) {
    return "Define P0, P1, P2 and the hard exclusions that override every tier.";
  }
  if (step === 4) {
    if (answers.resumeVariants.length < 1 || answers.resumeVariants.length > 6) {
      return "Add between 1 and 6 resume tracks.";
    }
    if (
      answers.resumeVariants.some(
        (variant) => !variant.name.trim() || !isHttpsLink(variant.url.trim()),
      )
    ) {
      return "Give every resume track a name and a valid HTTPS view-only link.";
    }
    const defaultVariants = answers.resumeVariants.filter(
      (variant) => variant.isDefault,
    );
    if (defaultVariants.length !== 1) {
      return "Choose exactly one default resume track.";
    }
  }
  if (step === 5 && !answers.consent) {
    return "Confirm private profile storage before submitting your calibration brief.";
  }
  return "";
}
