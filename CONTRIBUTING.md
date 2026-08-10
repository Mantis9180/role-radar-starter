# Contributing

Thank you for helping improve Role Radar Starter.

## Before opening a change

1. Search existing issues and security advisories.
2. Use an issue for product or schema changes; use a private advisory for vulnerabilities.
3. Keep fixtures fictional: use `owner@example.com`, `candidate@example.com`, `Example Labs`, and `https://example.com/jobs/example-role`.
4. Never include real resumes, job-search notes, employer data, candidate identities, tokens, or deployment IDs.

## Local checks

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run test
node scripts/security/tracked-file-scan.mjs
node scripts/security/privacy-scan.mjs
```

If Gitleaks is installed, also run:

```bash
gitleaks git --redact --no-banner
```

## Pull requests

- Explain the user problem and privacy impact.
- Add or update regression tests.
- Document schema or configuration changes.
- Preserve candidate isolation and refresh revision guards.
- Avoid new analytics, external scripts, or network calls unless they are essential, disclosed, and disabled by default.
- Do not weaken CSP, origin checks, size limits, no-store headers, or fail-closed authentication.

Changes to authentication, authorization, owner bootstrap, migrations, resume handling, logs, or refresh ingestion require focused security review.

## Commit hygiene

Use a public-safe Git identity, ideally a GitHub noreply address. Run the privacy checks before the first commit because removing a file later does not remove it from history.
