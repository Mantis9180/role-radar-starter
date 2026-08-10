# Security policy

## Supported use

Role Radar stores career preferences, resume-routing metadata, and application notes. Treat every deployment as a private system containing personal data.

## Deployment checklist

- Use a new database and project; never point a fork at another person's production resources.
- Keep `.openai/hosting.json`, `.env*`, D1 exports, resumes, logs, and generated deployment artifacts out of git.
- Configure exactly one initial owner. Review the `candidate_access` table before inviting candidates.
- Keep platform authentication enabled. Never trust client-supplied email, candidate ID, or owner flags.
- Keep `/api/refresh/*` and `/refresh-console` owner-only.
- Use direct HTTPS application URLs and label funding/upside claims as verified, inference, or unknown.
- Back up D1 before schema changes and define a deletion/export process before onboarding real users.
- Rotate access promptly when an owner or candidate should no longer have access.

## Built-in controls

The server derives identity from trusted hosting headers, resolves ownership from the active D1 roster, scopes all role/state queries to the authenticated profile, validates onboarding payloads, namespaces job IDs, and guards refresh writes with the candidate's current answer revision. The Browser console rejects cross-origin, multipart, oversized, duplicate-field, or malformed submissions and never embeds a bypass credential.

These are implemented code-path controls, not a security certification. The automated suite builds the Worker and runs it against a fresh in-memory D1 database, covering fail-closed provider configuration, owner/candidate authorization, cross-candidate isolation, revision conflicts, request boundaries, and state preservation. It does not emulate the OpenAI Sites edge identity service or a live deployment, and it is not a browser-integration test, penetration test, or adversarial-concurrency audit. Operators must run the deployment verification checklist with fictional accounts before storing real candidate data.

## Not included

This starter does not provide public self-signup, password authentication, email invitations, row-level encryption, background crawling, resume storage, or a compliance program. Add those deliberately for a public service; do not infer them from this starter.

## Reporting

Open a private security advisory in your fork rather than posting personal data or credentials in a public issue.
