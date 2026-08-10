# Architecture

## Trust boundaries

```text
Browser
  │ authenticated request
  ▼
Trusted identity boundary
  │ verified identity only
  ▼
Worker / Next.js routes
  ├── candidate-scoped onboarding and job APIs
  ├── candidate-scoped application state
  └── owner-only refresh console and ingestion
          │
          ▼
        D1 database
```

The identity boundary is part of the security model. Request headers are not identities unless a configured platform has stripped client copies and injected verified values.

## Data domains

- `candidate_access`: invite state and `owner` or `candidate` role.
- `candidate_profiles`: identity binding, onboarding answers, answer revision, and radar state.
- `jobs`: candidate-scoped researched opportunities and fit metadata.
- `user_job_state`: candidate-specific application status and notes.

Application state is deliberately separated from researched job metadata. Refresh context must never include private notes or application statuses.

## Candidate lifecycle

1. An administrator creates an active access record.
2. The user authenticates through the trusted provider.
3. The application binds the verified provider ID to the invited email.
4. The candidate completes onboarding and creates an answer revision.
5. Research uses that immutable revision as a concurrency guard.
6. A candidate-scoped refresh inserts, updates, or closes jobs.
7. Candidate application state remains untouched.

## Refresh safety

- Owner authorization is database-backed.
- Each write names exactly one candidate and their current answer revision.
- IDs are namespaced by candidate.
- Existing `firstSeenAt` values are preserved.
- Closed records remain stored so history survives.
- Normal refreshes do not deploy source code.
- A stale answer revision fails rather than applying research based on outdated preferences.

## Deployment portability

The repository uses a Worker-compatible web stack with a D1 binding named `DB`. Authentication is an adapter, not a portable header convention. A deployment is supported only after its adapter verifies identity at the server boundary and the security regression suite covers spoofed and missing identity behavior.
