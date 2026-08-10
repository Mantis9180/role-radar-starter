# Role Radar Starter

A private, multi-candidate job CRM for Associate Product Manager, Product Manager, and Senior Product Manager searches. Each candidate defines their own goals, constraints, P0/P1/P2 model, and resume variants. An owner researches live roles through a browser-friendly console; the radar then recommends the closest resume and one concrete tailoring move per role.

This repository contains no candidate data, resumes, employer listings, access emails, deployment IDs, or production secrets.

Role Radar is decision-support software. It does **not** submit applications, send messages, scrape logged-in websites, or guarantee the value of equity or future funding. Research should use public employer or ATS pages and comply with site terms and applicable law.

## What it includes

- Invite-only sign-in using the hosting platform's authenticated-user headers.
- A six-step APM/PM/SPM onboarding flow with consent, hard exclusions, compensation constraints, location preferences, and up to six resume tracks.
- Candidate-isolated role feeds, application statuses, and notes in Cloudflare D1.
- P0/P1/P2 prioritisation, freshness, funding-evidence labels, and resume-fit routing.
- An owner-only `/refresh-console` that works with ordinary Browser reading, typing, and form submission—no browser-side tokens or cookie access.
- Strict namespaced job IDs: `<candidateId>::<sourceJobId>`; there is no legacy unprefixed path.

## Privacy and security defaults

- Default deny: no email is admitted unless it is in `candidate_access`.
- `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_CANDIDATE_EMAILS` are runtime configuration, never source constants.
- `AUTH_PROVIDER` must be exactly `openai-sites`; every other value fails closed in the initial release.
- Candidate feeds and application state are always filtered by authenticated candidate/user IDs.
- Refresh context and writes are owner-only, no-store, revision-guarded, candidate-scoped, and size-limited.
- Refresh forms enforce same-origin POSTs, strict fields, bounded bodies, and a restrictive Content Security Policy.
- Onboarding consent is required before a profile appears in refresh research.
- Closed roles remain stored so application history survives; `firstSeenAt` is immutable on update.

Read [SECURITY.md](SECURITY.md) before deploying or accepting users.

## Local build and validation

Requirements: Node.js 22.13+ and pnpm.

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Run `pnpm dev` to work on unauthenticated UI and build behavior.
3. Use `pnpm test` for a production build plus the included source-contract and Miniflare integration tests.
4. Run the privacy gates documented below before committing.

The local Cloudflare configuration creates a development D1 binding named `DB`. The runtime also creates missing tables defensively; `drizzle/0000_role_radar.sql` is the clean deployment migration.

Local development does **not** provide an OpenAI Sites identity boundary, so a normal local browser cannot complete sign-in or safely exercise authenticated candidate/owner flows. The automated Miniflare suite injects fictional Sites headers only inside an isolated test Worker to verify server-side authorization and D1 isolation. Deploy to a private OpenAI Site to test real sign-in. Do not add any production path that accepts client-supplied identity headers.

## Deploying with Sites

1. Create a fresh Sites project with a D1 binding named `DB`.
2. Copy `.openai/hosting.example.json` to `.openai/hosting.json` and replace the project ID. The real file is ignored by git.
3. Configure `BOOTSTRAP_OWNER_EMAIL` as a private runtime value. Configure `BOOTSTRAP_CANDIDATE_EMAILS` only for the initial invite roster.
4. Build, save a version, and deploy it with authenticated access. Do not expose the owner console publicly.
5. After first boot, manage invitations directly in `candidate_access`; do not commit them back into source.

The initial release supports only the Sites authentication boundary implemented in `app/chatgpt-auth.ts`. It is **not safe to expose directly as a standalone Worker**. A fork deployed elsewhere must first implement and test a verified server-side identity adapter, including spoofed- and missing-identity cases.

The repository tests execute the built Worker against a fresh in-memory D1 database and cover authorization roles, candidate/job isolation, optimistic revisions, state preservation, and refresh-console request boundaries. They do not emulate the actual Sites edge identity service or constitute a penetration test; every deployment must complete the verification checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Refresh workflow

The owner opens **Research console**, reads each rendered candidate context, researches verified employer/ATS pages, and submits only that candidate's `jobs` and `closedRoles` fragment. The server renders and independently revalidates the candidate ID and current answers revision, validates the chosen resume variant, namespaces every role ID, and rejects stale criteria with HTTP 409.

See [docs/AUTOMATION_REFRESH.md](docs/AUTOMATION_REFRESH.md) for an automation-ready prompt contract and [docs/PERSONA_PLAYBOOK.md](docs/PERSONA_PLAYBOOK.md) for APM/PM/SPM baselines.

The refresh workflow never submits applications and must not depend on a logged-in social-network session. See [docs/REFRESH_WORKFLOW.md](docs/REFRESH_WORKFLOW.md) for the privacy and ranking rules.

## Data model

- `candidate_access`: invite roster and owner/candidate role.
- `candidate_profiles`: onboarding answers, consent, and optimistic revision.
- `jobs`: isolated researched opportunities.
- `user_job_state`: private status and notes per authenticated user and role.

## License

MIT. See [LICENSE](LICENSE).

Before publishing a fork, also read [PRIVACY.md](PRIVACY.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), then run the repository privacy gates.
