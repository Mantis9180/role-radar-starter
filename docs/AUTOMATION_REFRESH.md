# Browser-native refresh contract

This workflow is intentionally compatible with Browser agents that can inspect rendered pages, click, type, and submit forms but cannot execute page-scoped `fetch` or read cookies.

## Run sequence

1. Open the authenticated Role Radar home page with the owner account.
2. Click **Research console**. If it shows a sign-in or owner-access error, stop without writing.
3. Read each candidate's rendered JSON context independently. Treat onboarding answers and the exact `answersRevision` as authoritative.
4. Re-verify existing open roles and research new roles using the APM/PM/SPM playbook.
5. In that candidate's form, enter a JSON object containing only:

```json
{
  "activateRadar": true,
  "closedRoles": [],
  "jobs": []
}
```

6. Click the candidate-specific save button. A rendered **Candidate refresh saved** banner is the authoritative success state.
7. Repeat for the next candidate. Never copy one candidate's criteria, roles, resume IDs, statuses, or notes into another candidate's feed.

## Role payload rules

Each job needs a stable `sourceJobId`, company, role, location, work mode, direct HTTPS apply URL, concise description, fit reason, tailoring action, one returned resume variant, P0/P1/P2 rank, experience fit, funding context/evidence, `firstSeenAt`, listing status, optional posted date, and `lastVerifiedAt`.

- Preserve an existing role's `firstSeenAt` exactly.
- Use discovery time only for a new role.
- Put newly closed or stale listings in `closedRoles`; never delete them.
- Activate a calibrating radar only when the same pass contains at least one verified-open role.
- On a 409, reload the console and recompute against the new criteria.

The server renders the candidate identity and answer revision into the form, then independently revalidates them together with role namespacing and owner authorization on submission.
