# Authentication and authorization

## Fail-closed rule

The application must deny access when any of the following is missing or invalid:

- a supported authentication adapter;
- a server-verified user ID and normalized email;
- the `DB` binding;
- an active access record;
- a candidate profile bound to the verified user;
- an active `owner` database role for owner-only operations.

Never convert an arbitrary request header, query parameter, cookie value, candidate ID, or email literal directly into an authenticated user.

## OpenAI Sites

OpenAI Sites can place a Site behind its sign-in boundary and inject authenticated-user headers. Trust those values only in the Sites runtime where the platform owns the edge boundary. Do not expose an origin that lets clients reach the Worker while bypassing that boundary.

Keep deployment identity out of Git:

- do not commit `.openai/hosting.json`;
- do not publish project IDs in fixtures or screenshots;
- use the Sites tooling to bind D1 as `DB`;
- keep the Site private while validating access-denied and owner-only behavior.

Consult the current Sites authentication documentation during setup because platform contracts can change.

## Cloudflare deployment is not included

The initial release supports `AUTH_PROVIDER=openai-sites` only. Every other provider value must fail closed. A standalone Worker is unsafe until a fork implements and tests an explicit adapter. Recommended designs include Cloudflare Access with a verified Access JWT or a reviewed OIDC library that validates issuer, audience, signature, expiry, nonce/state, and callback origin.

Cloudflare Access guidance:

1. Put every application route behind an Access policy.
2. Validate the signed Access token server-side; do not trust only the convenience email header.
3. Pin the expected application audience and issuer.
4. Strip or ignore client-supplied identity headers.
5. Deny direct alternate hostnames that bypass Access.
6. Keep Access service tokens separate from human sessions.

Setting an environment variable alone does not create an adapter. Do not expose a direct Worker hostname until the new adapter and spoofing regression tests are implemented.

## Owner bootstrap

Do not hardcode an owner email in source or migrations. Use a one-time administrative command or a secret-backed bootstrap that:

1. runs only when no owner exists;
2. normalizes and validates the configured email;
3. inserts one active `owner` access record;
4. records a non-personal audit reason;
5. is disabled or removed after successful initialization.

Changing a candidate ID must not change authority. Owner checks query the active access role.

## Multi-candidate consent

Before adding a candidate, tell them:

- what onboarding and job data is stored;
- that the owner can see research criteria and resume-variant references;
- that application notes and statuses are excluded from the refresh console and other candidates, but remain accessible to the D1 operator or database administrator;
- how to export or delete their data;
- how to revoke access.
