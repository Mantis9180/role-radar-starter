# Threat model

## Assets

- candidate identity and contact data;
- onboarding answers and compensation expectations;
- resume-variant references;
- job fit/tailoring analysis;
- private application status and notes;
- owner privileges and refresh capability;
- authentication, database, and deployment credentials.

## Actors

- unauthenticated internet user;
- authenticated but uninvited user;
- candidate attempting cross-candidate access;
- non-owner attempting refresh or administration;
- malicious job listing or URL;
- compromised operator browser or deployment credential;
- accidental contributor publishing private fixtures or history.

## Key threats and controls

| Threat | Primary controls |
| --- | --- |
| Forged identity headers | Trusted server-side adapter, token verification, no bypass origin, fail closed |
| Candidate data crossover | Candidate-scoped queries and IDs, authorization on every route, required deployment isolation testing |
| Owner privilege escalation | Active database role, no magic ID/email, selected source-contract checks plus required deployment testing |
| Cross-site refresh submission | Same-origin validation, fetch-metadata checks, POST-only mutation, strict content type |
| Oversized or malformed refresh | Raw-byte limit, decoded-size limit, schema validation, bounded arrays and strings |
| Stale research overwriting new preferences | Exact answer-revision concurrency guard |
| Refresh overwriting application state | Separate tables and APIs; no application state in refresh context |
| Sensitive response caching | `Cache-Control: private, no-store`; no shared caching |
| Resume URL leakage | Avoid signed links, redact logs, no payload logging, private views only |
| Malicious apply URL | Allow only `https:` links, render as inert text until user action, no server-side fetch by default |
| Public repository leakage | Fresh history, fictional fixtures, denylist, privacy scanner, Gitleaks, push protection |
| Database exfiltration | Least-privilege bindings, platform access controls, encrypted backups, retention/deletion |
| Automated application abuse | Out of scope and explicitly absent; no submit, email, or logged-in scraping capability |

## Out of scope

- security of an employer or ATS website;
- accuracy or legality of third-party job descriptions;
- financial value of equity or future fundraising;
- malware on an operator or candidate device;
- custom forks that bypass the documented authentication boundary.

## Residual risk

The owner can see profile criteria and resume references required to run research. Application statuses and notes are excluded from refresh context, but the D1 operator can access all stored records. A compromised owner account or database binding can expose multiple candidates. Start single-user, use phishing-resistant authentication where available, minimize collected fields, and keep retention short.
