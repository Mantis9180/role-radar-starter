# Deployment guide

## 1. Prepare a clean repository

Create a new repository with no history copied from a personal deployment. Do not fork a private instance. Verify the initial commit uses a public-safe Git identity.

```bash
node scripts/security/tracked-file-scan.mjs
node scripts/security/privacy-scan.mjs
gitleaks git --redact --no-banner
```

## 2. Configure D1

Create a new database for this deployment. Copy `wrangler.example.jsonc` to the ignored `wrangler.jsonc` and replace its placeholder database ID locally. Bind the production database as `DB`.

Never reuse, export, or import a database from another person's job search. Migrations should create structure only; they must not insert candidates, access grants, onboarding answers, jobs, or resume references.

## 3. Configure authentication

The initial release supports only `AUTH_PROVIDER=openai-sites`. Follow [AUTHENTICATION.md](AUTHENTICATION.md) and confirm that every other value fails closed before enabling owner bootstrap. Do not deploy directly to Cloudflare until a reviewed identity adapter and its spoofing tests have been implemented.

## 4. Bootstrap one owner

Use the project's one-time administrative process. Do not embed the owner in source, a migration, public config, fixture, or image. Remove the bootstrap secret immediately afterward.

## 5. Validate locally

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run test
pnpm run build
node scripts/security/tracked-file-scan.mjs
node scripts/security/privacy-scan.mjs
```

These commands include source-contract checks and built-Worker Miniflare tests against a fresh in-memory D1 database. They exercise fictional Sites headers, role authorization, candidate isolation, refresh revisions, and state preservation, but they do not emulate the OpenAI Sites edge identity service or constitute penetration testing. Perform the following checks on a private deployment with fictional accounts before onboarding real users.

Test at least:

- unauthenticated access is denied;
- an authenticated but uninvited user is denied without profile creation;
- one candidate cannot read or mutate another candidate;
- a non-owner cannot reach refresh context or ingestion;
- spoofed or missing identity is denied;
- cross-origin, malformed, oversized, and stale-revision refreshes fail;
- authenticated responses are `private, no-store`;
- application notes and statuses never enter refresh context;
- startup without an owner remains closed.

## 6. Deploy privately first

Deploy behind authentication, run the checks against the production hostname, and inspect logs for accidental personal data. Keep access to one owner until the full test matrix passes.

## 7. Invite carefully

Share the operator privacy notice, obtain consent, add only the intended email, and verify candidate isolation with fictional test accounts before inviting a real person.

## 8. Operate safely

- Back up D1 only to encrypted, access-controlled storage.
- Define deletion and retention procedures.
- Review Dependabot and CodeQL alerts.
- Rotate credentials after staff or operator changes.
- Re-run privacy and secret scans before public releases.
- Never paste refresh payloads or candidate context into public issues.
