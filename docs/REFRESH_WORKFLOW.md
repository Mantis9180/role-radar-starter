# Research refresh workflow

## Purpose

A refresh converts public job research into a candidate-specific feed. It does not apply, contact anyone, or alter a candidate's private tracking state.

## Inputs

For one candidate at a time, use:

- persona and target titles;
- demonstrated years, ownership, leadership, and domain scope;
- strengths and hard exclusions;
- locations and work modes;
- compensation and company-stage preferences;
- the candidate's P0/P1/P2 definitions;
- available resume-variant labels;
- the exact onboarding answer revision.

## Persona baselines

Use these only when the candidate has not overridden them:

- **APM:** credible early-career product, product operations, product analytics, discovery, and delivery roles.
- **PM:** independent end-to-end ownership with measurable product or business outcomes.
- **SPM:** larger strategic or portfolio scope, senior stakeholder leadership, ambiguous problem ownership, and organizational leverage.

Judge the requirements in the posting, not its title alone.

## Research rules

1. Apply hard gates before scoring: authorization, location, work mode, minimum experience, required domain/technical background, shifts, and compensation when specified.
2. Prefer direct employer or ATS pages. Label an aggregator when no direct source exists.
3. Verify every retained role is still accepting applications.
4. Within each tier, sort newly posted or newly discovered roles first, then fit.
5. Funding can provide context but cannot independently create a P0. Mark future funding or upside as inference; never promise equity value.
6. Preserve `firstSeenAt` for existing roles.
7. Close stale or removed listings; do not delete their history.
8. Select one of the candidate's resume variants and provide one concrete tailoring action.
9. Never read or change application statuses or notes.

## Tier interpretation

- **P0:** immediate, highest-conviction tailored applications based on exceptional fit, freshness or urgency, and/or asymmetric growth opportunity.
- **P1:** strong fit and credible experience match, including excellent established companies without a funding catalyst.
- **P2:** selective adjacent bets with a meaningful title, tenure, technical, domain, location, or work-mode stretch.

The candidate's custom definitions win when they differ.

## Browser-compatible owner console

The owner console should render context as HTML and accept normal same-origin form submissions. This avoids relying on arbitrary page JavaScript, cookie extraction, bypass tokens, or a logged-in scraping session.

Operational requirements:

- authorize the owner before reading the request body;
- render one isolated candidate section at a time;
- keep candidate ID and answer revision server-validated;
- cap raw and decoded payload size;
- require exact allowed fields and strict schemas;
- use POST/Redirect/GET and show a server-rendered success state;
- return private, no-store responses with a restrictive CSP;
- retain the JSON API for trusted integrations, not as an authentication bypass.
