# Privacy statement for self-hosters

Role Radar Starter is self-hosted software. The operator—not this repository—controls the deployed service and is responsible for its privacy notice, lawful basis, retention rules, access requests, and security.

## Data the application may store

- authenticated account identifiers and email address;
- onboarding answers such as target roles, experience, locations, work mode, compensation, domains, exclusions, and tier definitions;
- resume-variant names or references;
- researched job metadata and fit/tailoring notes;
- application status and private candidate notes;
- timestamps needed for synchronization and conflict prevention.

Do not store resume contents unless you add a reviewed encrypted storage design. Avoid signed or query-token URLs; they can grant unintended access and may leak through logs or screenshots.

## Visibility

In multi-candidate mode, the owner can access onboarding criteria, resume links or references, and researched job feeds needed to run refreshes. Candidate application notes and statuses remain outside refresh context and inaccessible to other candidates. The D1 operator or database administrator may still access all stored records, including application notes and statuses, for administration. Disclose both owner and database-operator visibility before inviting anyone.

## Recommended operator policy

- Start in single-user mode.
- Invite another candidate only with informed consent.
- Collect only fields needed for matching.
- Never use candidate data to submit applications or contact employers without an explicit, separate action by the candidate.
- Provide export, correction, revocation, and deletion procedures.
- Define a short retention period for inactive accounts and audit data.
- Remove access immediately when consent is withdrawn.
- Keep backups encrypted and apply the same deletion schedule.
- Avoid logging email addresses, resume references, onboarding JSON, application notes, or refresh payloads.

## Third-party processing

Your hosting provider, identity provider, database platform, error-monitoring service, and any research tools may process data. Configure each service to minimize logging and retention, document its role, and sign any agreements required in your jurisdiction.

## Public job research

Use public employer or ATS pages where possible. Do not automate access to logged-in networks, bypass access controls, or republish personal recruiter data. Respect terms of service, robots policies, rate limits, and applicable law.

## Security is not privacy by itself

`robots: noindex` and an unguessable URL do not provide access control. Every private route and response must be authenticated, authorized, candidate-scoped, and non-cacheable.
