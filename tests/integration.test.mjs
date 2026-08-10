import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const workerPath = fileURLToPath(
  new URL("../dist/server/index.js", import.meta.url),
);

const OWNER = {
  userId: "user-owner",
  email: "owner@example.com",
  displayName: "Example Owner",
};
const CANDIDATE_A = {
  userId: "user-candidate-a",
  email: "candidate-a@example.com",
  displayName: "Candidate Alpha",
};
const CANDIDATE_B = {
  userId: "user-candidate-b",
  email: "candidate-b@example.com",
  displayName: "Candidate Beta",
};
const UNINVITED = {
  userId: "user-uninvited",
  email: "uninvited@example.com",
  displayName: "Uninvited Example",
};

const FIRST_SEEN = "2026-07-01T09:00:00.000Z";
const FIRST_VERIFIED = "2026-08-10T09:00:00.000Z";
const SECOND_VERIFIED = "2026-08-10T10:00:00.000Z";
const CLOSED_VERIFIED = "2026-08-10T11:00:00.000Z";
const STATE_SENTINEL = "STATE_SENTINEL_MUST_NOT_LEAK";

function identityHeaders(identity) {
  if (!identity) return {};
  return {
    "oai-authenticated-user-id": identity.userId,
    "oai-authenticated-user-email": identity.email,
    "oai-authenticated-user-full-name": encodeURIComponent(
      identity.displayName,
    ),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

function onboardingAnswers(label) {
  return {
    schemaVersion: 2,
    persona: "PM",
    targetTitles: ["Product Manager"],
    idealMandate: `Own the ${label} product area end to end.`,
    scopeLevels: ["Own a product area end to end"],
    strengths: ["Zero-to-one", "Product strategy"],
    strongestOutcomes: `Built and scaled ${label} products.`,
    preferredLocations: "Remote",
    workModes: ["Remote"],
    p0Definition: "Exceptional role and scope fit.",
    p1Definition: "Strong role or company fit.",
    p2Definition: "A deliberate adjacent bet.",
    hardExclusions: "No unpaid roles.",
    resumeVariants: [
      {
        id: `core-${label.toLowerCase()}`,
        name: `Core PM ${label}`,
        url: `https://example.com/resumes/${label.toLowerCase()}.pdf`,
        target: "Core product management",
        emphasis: "End-to-end ownership",
        isDefault: true,
      },
    ],
    consent: true,
  };
}

function refreshJob({
  sourceJobId = "shared-role",
  company,
  resumeFit,
  firstSeenAt = FIRST_SEEN,
  lastVerifiedAt = FIRST_VERIFIED,
}) {
  return {
    sourceJobId,
    company,
    role: "Product Manager",
    location: "Remote",
    workMode: "Remote",
    applyUrl: `https://example.com/jobs/${sourceJobId}`,
    description: "Own a bounded product area and measurable outcomes.",
    fitReason: "Matches end-to-end product ownership experience.",
    tailorAdvice: "Lead with the most relevant product outcome.",
    resumeFit,
    priority: "P1",
    priorityRank: 1,
    experienceFit: "Direct fit",
    fundingLabel: "Not assessed",
    fundingDetail: "No funding claim is needed for this fixture.",
    fundingEvidence: "Unknown",
    firstSeenAt,
    listingStatus: "open",
    postedAt: "2026-08-01",
    lastVerifiedAt,
  };
}

async function responseJson(response) {
  const body = await response.text();
  assert.notEqual(body, "", `expected JSON body for HTTP ${response.status}`);
  return JSON.parse(body);
}

function cookiePair(setCookie) {
  assert.ok(setCookie, "expected Set-Cookie header");
  return setCookie.split(";", 1)[0];
}

test(
  "built worker fails closed when the trusted auth provider is absent or invalid",
  { timeout: 30_000 },
  async (t) => {
    for (const scenario of [
      { name: "missing provider", provider: undefined },
      { name: "invalid provider", provider: "untrusted-example" },
    ]) {
      await t.test(scenario.name, async () => {
        const bindings = {};
        if (scenario.provider !== undefined) {
          bindings.AUTH_PROVIDER = scenario.provider;
        }
        const mf = new Miniflare({
          rootPath: projectRoot,
          scriptPath: workerPath,
          modules: true,
          modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
          compatibilityDate: "2026-05-15",
          compatibilityFlags: ["nodejs_compat"],
          bindings,
          d1Databases: {
            DB: `provider-gate-${scenario.provider ?? "missing"}`,
          },
          d1Persist: false,
        });
        t.after(() => mf.dispose());

        const baseUrl = await mf.ready;
        const response = await mf.dispatchFetch(
          new URL("/api/jobs", baseUrl),
          {
            redirect: "manual",
            headers: identityHeaders(OWNER),
          },
        );
        assert.equal(response.status, 401);
      });
    }
  },
);

test(
  "built worker enforces candidate isolation and refresh security in Miniflare",
  { timeout: 60_000 },
  async (t) => {
    const mf = new Miniflare({
      rootPath: projectRoot,
      scriptPath: workerPath,
      modules: true,
      modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
      compatibilityDate: "2026-05-15",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        AUTH_PROVIDER: "openai-sites",
        BOOTSTRAP_OWNER_EMAIL: OWNER.email,
        BOOTSTRAP_CANDIDATE_EMAILS: [
          CANDIDATE_A.email,
          CANDIDATE_B.email,
        ].join(","),
      },
      d1Databases: { DB: "role-radar-integration" },
      d1Persist: false,
    });
    t.after(() => mf.dispose());

    const baseUrl = await mf.ready;
    const request = (
      path,
      { identity, headers, trustedMutation, ...init } = {},
    ) => {
      const method = (init.method ?? "GET").toUpperCase();
      const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
      const includeTrustedOrigin = trustedMutation ?? isMutation;
      return mf.dispatchFetch(new URL(path, baseUrl), {
        redirect: "manual",
        ...init,
        headers: {
          ...identityHeaders(identity),
          ...(includeTrustedOrigin
            ? {
                origin: baseUrl.origin,
                "sec-fetch-site": "same-origin",
              }
            : {}),
          ...headers,
        },
      });
    };

    let candidateAId;
    let candidateBId;
    let candidateARevision;
    let candidateBRevision;
    let candidateAJobId;
    let candidateBJobId;

    await t.test("auth is default-deny and roles are enforced", async () => {
      const signedOutJobs = await request("/api/jobs");
      assert.equal(
        signedOutJobs.status,
        401,
        `unexpected response: ${await signedOutJobs.text()}`,
      );

      const uninvitedJobs = await request("/api/jobs", {
        identity: UNINVITED,
      });
      assert.equal(uninvitedJobs.status, 403);
      const db = await mf.getD1Database("DB");
      const uninvitedProfile = await db
        .prepare(
          "SELECT id FROM candidate_profiles WHERE email = ? LIMIT 1",
        )
        .bind(UNINVITED.email)
        .first();
      assert.equal(uninvitedProfile, null);

      const candidateJobs = await request("/api/jobs", {
        identity: CANDIDATE_A,
      });
      assert.equal(candidateJobs.status, 200);

      const ownerJobs = await request("/api/jobs", { identity: OWNER });
      assert.equal(ownerJobs.status, 200);

      const signedOutContext = await request("/api/refresh/context");
      assert.equal(signedOutContext.status, 401);

      const uninvitedContext = await request("/api/refresh/context", {
        identity: UNINVITED,
      });
      assert.equal(uninvitedContext.status, 403);

      const candidateContext = await request("/api/refresh/context", {
        identity: CANDIDATE_A,
      });
      assert.equal(candidateContext.status, 403);

      const candidateRefreshWrite = await request("/api/refresh/jobs", {
        identity: CANDIDATE_A,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(candidateRefreshWrite.status, 403);

      const ownerContext = await request("/api/refresh/context", {
        identity: OWNER,
      });
      assert.equal(ownerContext.status, 200);

      const signedOutConsole = await request("/refresh-console");
      assert.equal(signedOutConsole.status, 401);
      const candidateConsole = await request("/refresh-console", {
        identity: CANDIDATE_A,
      });
      assert.equal(candidateConsole.status, 403);
      const ownerConsole = await request("/refresh-console", {
        identity: OWNER,
      });
      assert.equal(ownerConsole.status, 200);
    });

    await t.test(
      "demoted and inactive owners lose refresh access immediately",
      async () => {
        const db = await mf.getD1Database("DB");
        const assertRefreshDenied = async (label) => {
          const getResponse = await request("/api/refresh/context", {
            identity: OWNER,
          });
          assert.equal(getResponse.status, 403, `${label} owner GET must fail`);

          const postResponse = await request("/api/refresh/jobs", {
            identity: OWNER,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          assert.equal(postResponse.status, 403, `${label} owner POST must fail`);
        };

        await db
          .prepare(
            "UPDATE candidate_access SET role = 'candidate' WHERE email = ?",
          )
          .bind(OWNER.email)
          .run();
        await assertRefreshDenied("demoted");

        await db
          .prepare(
            "UPDATE candidate_access SET role = 'owner', status = 'inactive' WHERE email = ?",
          )
          .bind(OWNER.email)
          .run();
        await assertRefreshDenied("inactive");

        await db
          .prepare(
            "UPDATE candidate_access SET role = 'owner', status = 'active' WHERE email = ?",
          )
          .bind(OWNER.email)
          .run();
        const restored = await db
          .prepare(
            "SELECT role, status FROM candidate_access WHERE email = ?",
          )
          .bind(OWNER.email)
          .first();
        assert.deepEqual(restored, { role: "owner", status: "active" });
      },
    );

    await t.test(
      "bounded JSON readers reject oversized and encoded bodies without writes",
      async () => {
        const db = await mf.getD1Database("DB");
        const countState = () =>
          db
            .prepare("SELECT COUNT(*) AS count FROM user_job_state")
            .first();
        const before = await countState();

        const declaredBody = JSON.stringify({
          jobId: "declared-oversized",
          notes: "x".repeat(9_000),
        });
        const declaredBytes = new TextEncoder().encode(declaredBody).byteLength;
        const declaredResponse = await request("/api/jobs", {
          identity: CANDIDATE_A,
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "content-length": String(declaredBytes),
          },
          body: declaredBody,
        });
        assert.equal(declaredResponse.status, 413);

        const encoder = new TextEncoder();
        const streamedBody = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('{"notes":"'));
            controller.enqueue(encoder.encode("y".repeat(5_000)));
            controller.enqueue(encoder.encode("z".repeat(5_000)));
            controller.enqueue(encoder.encode('"}'));
            controller.close();
          },
        });
        const streamedResponse = await request("/api/jobs", {
          identity: CANDIDATE_A,
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: streamedBody,
          duplex: "half",
        });
        assert.equal(streamedResponse.status, 413);

        const encodedResponse = await request("/api/jobs", {
          identity: CANDIDATE_A,
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
          },
          body: "{}",
        });
        assert.equal(encodedResponse.status, 415);

        const after = await countState();
        assert.equal(after.count, before.count);
      },
    );

    await t.test(
      "every JSON mutation rejects missing and cross-origin requests",
      async () => {
        const mutationCases = [
          {
            path: "/api/profile",
            method: "PATCH",
            identity: CANDIDATE_A,
          },
          {
            path: "/api/jobs",
            method: "PATCH",
            identity: CANDIDATE_A,
          },
          {
            path: "/api/refresh/jobs",
            method: "POST",
            identity: OWNER,
          },
        ];

        for (const mutation of mutationCases) {
          const missingOrigin = await request(mutation.path, {
            ...mutation,
            trustedMutation: false,
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          assert.equal(
            missingOrigin.status,
            403,
            `${mutation.path} must reject a missing Origin`,
          );

          const foreignOrigin = await request(mutation.path, {
            ...mutation,
            headers: {
              "content-type": "application/json",
              origin: "https://example.com",
              "sec-fetch-site": "cross-site",
            },
            body: "{}",
          });
          assert.equal(
            foreignOrigin.status,
            403,
            `${mutation.path} must reject a foreign Origin`,
          );
        }
      },
    );

    await t.test("two invited candidates complete isolated profiles", async () => {
      for (const [identity, label] of [
        [CANDIDATE_A, "Alpha"],
        [CANDIDATE_B, "Beta"],
      ]) {
        const response = await request("/api/profile", {
          identity,
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            onboardingStatus: "complete",
            answersJson: JSON.stringify(onboardingAnswers(label)),
          }),
        });
        assert.equal(response.status, 200);
      }

      const contextResponse = await request("/api/refresh/context", {
        identity: OWNER,
      });
      assert.equal(contextResponse.status, 200);
      const context = await responseJson(contextResponse);
      assert.equal(context.candidates.length, 2);

      const alpha = context.candidates.find(
        (candidate) => candidate.displayName === CANDIDATE_A.displayName,
      );
      const beta = context.candidates.find(
        (candidate) => candidate.displayName === CANDIDATE_B.displayName,
      );
      assert.ok(alpha);
      assert.ok(beta);
      candidateAId = alpha.candidateId;
      candidateBId = beta.candidateId;
      candidateARevision = alpha.answersRevision;
      candidateBRevision = beta.answersRevision;
    });

    await t.test(
      "the same source ID is namespaced and feeds remain isolated",
      async () => {
        const alphaRefresh = await request("/api/refresh/jobs", {
          identity: OWNER,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            candidateId: candidateAId,
            answersRevision: candidateARevision,
            activateRadar: true,
            closedRoles: [],
            jobs: [
              refreshJob({
                company: "Alpha Products",
                resumeFit: "core-alpha",
              }),
            ],
          }),
        });
        assert.equal(alphaRefresh.status, 200);

        const betaRefresh = await request("/api/refresh/jobs", {
          identity: OWNER,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            candidateId: candidateBId,
            answersRevision: candidateBRevision,
            activateRadar: true,
            closedRoles: [],
            jobs: [
              refreshJob({
                company: "Beta Products",
                resumeFit: "core-beta",
              }),
            ],
          }),
        });
        assert.equal(betaRefresh.status, 200);

        candidateAJobId = `${candidateAId}::shared-role`;
        candidateBJobId = `${candidateBId}::shared-role`;
        const db = await mf.getD1Database("DB");
        const rows = await db
          .prepare(
            "SELECT id, candidate_id AS candidateId FROM jobs ORDER BY candidate_id",
          )
          .all();
        assert.deepEqual(
          rows.results.map((row) => [row.id, row.candidateId]),
          [
            [candidateAJobId, candidateAId],
            [candidateBJobId, candidateBId],
          ].sort((left, right) => left[1].localeCompare(right[1])),
        );

        const alphaJobs = await responseJson(
          await request("/api/jobs", { identity: CANDIDATE_A }),
        );
        const betaJobs = await responseJson(
          await request("/api/jobs", { identity: CANDIDATE_B }),
        );
        assert.deepEqual(alphaJobs.jobs.map((job) => job.id), [candidateAJobId]);
        assert.deepEqual(betaJobs.jobs.map((job) => job.id), [candidateBJobId]);

        const crossPatch = await request("/api/jobs", {
          identity: CANDIDATE_A,
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jobId: candidateBJobId,
            status: "applied",
            notes: "must not be written",
          }),
        });
        assert.equal(crossPatch.status, 404);
        const crossState = await db
          .prepare(
            "SELECT 1 AS present FROM user_job_state WHERE user_id = ? AND job_id = ?",
          )
          .bind(CANDIDATE_A.userId, candidateBJobId)
          .first();
        assert.equal(crossState, null);
      },
    );

    await t.test(
      "owner context excludes private application state sentinels",
      async () => {
        const stateResponse = await request("/api/jobs", {
          identity: CANDIDATE_A,
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jobId: candidateAJobId,
            status: "saved",
            notes: STATE_SENTINEL,
          }),
        });
        assert.equal(stateResponse.status, 200);

        const contextResponse = await request("/api/refresh/context", {
          identity: OWNER,
        });
        assert.equal(contextResponse.status, 200);
        const rawContext = await contextResponse.text();
        assert.doesNotMatch(rawContext, new RegExp(STATE_SENTINEL));
        assert.doesNotMatch(rawContext, /"notes"\s*:/);
        assert.doesNotMatch(rawContext, /"status"\s*:\s*"saved"/);
      },
    );

    await t.test("stale revisions return 409 without writes", async () => {
      const db = await mf.getD1Database("DB");
      const staleRevision = candidateARevision;
      candidateARevision = "answers-v1-integration-new-revision";
      await db
        .prepare(
          "UPDATE candidate_profiles SET answers_revision = ? WHERE id = ?",
        )
        .bind(candidateARevision, candidateAId)
        .run();

      const before = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE candidate_id = ?",
        )
        .bind(candidateAId)
        .first();
      const staleResponse = await request("/api/refresh/jobs", {
        identity: OWNER,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidateId: candidateAId,
          answersRevision: staleRevision,
          activateRadar: false,
          closedRoles: [
            {
              sourceJobId: "shared-role",
              lastVerifiedAt: CLOSED_VERIFIED,
            },
          ],
          jobs: [
            refreshJob({
              sourceJobId: "stale-write",
              company: "Stale Products",
              resumeFit: "core-alpha",
            }),
          ],
        }),
      });
      assert.equal(staleResponse.status, 409);
      const after = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE candidate_id = ?",
        )
        .bind(candidateAId)
        .first();
      assert.equal(after.count, before.count);
      const existing = await db
        .prepare(
          "SELECT listing_status AS listingStatus, last_verified_at AS lastVerifiedAt FROM jobs WHERE id = ?",
        )
        .bind(candidateAJobId)
        .first();
      assert.deepEqual(existing, {
        listingStatus: "open",
        lastVerifiedAt: FIRST_VERIFIED,
      });
    });

    await t.test(
      "refresh retains firstSeenAt and closure preserves application state",
      async () => {
        const updateResponse = await request("/api/refresh/jobs", {
          identity: OWNER,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            candidateId: candidateAId,
            answersRevision: candidateARevision,
            activateRadar: false,
            closedRoles: [],
            jobs: [
              refreshJob({
                company: "Alpha Products Updated",
                resumeFit: "core-alpha",
                firstSeenAt: "2026-08-10T10:00:00.000Z",
                lastVerifiedAt: SECOND_VERIFIED,
              }),
            ],
          }),
        });
        assert.equal(updateResponse.status, 200);

        const db = await mf.getD1Database("DB");
        const updatedJob = await db
          .prepare(
            "SELECT company, first_seen_at AS firstSeenAt, last_verified_at AS lastVerifiedAt FROM jobs WHERE id = ?",
          )
          .bind(candidateAJobId)
          .first();
        assert.deepEqual(updatedJob, {
          company: "Alpha Products Updated",
          firstSeenAt: FIRST_SEEN,
          lastVerifiedAt: SECOND_VERIFIED,
        });

        const closeResponse = await request("/api/refresh/jobs", {
          identity: OWNER,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            candidateId: candidateAId,
            answersRevision: candidateARevision,
            activateRadar: false,
            closedRoles: [
              {
                sourceJobId: "shared-role",
                lastVerifiedAt: CLOSED_VERIFIED,
              },
            ],
            jobs: [],
          }),
        });
        assert.equal(closeResponse.status, 200);

        const state = await db
          .prepare(
            `SELECT j.listing_status AS listingStatus, s.status, s.notes
             FROM jobs j
             INNER JOIN user_job_state s ON s.job_id = j.id
             WHERE j.id = ? AND s.user_id = ?`,
          )
          .bind(candidateAJobId, CANDIDATE_A.userId)
          .first();
        assert.deepEqual(state, {
          listingStatus: "closed",
          status: "saved",
          notes: STATE_SENTINEL,
        });

        const candidateJobs = await responseJson(
          await request("/api/jobs", { identity: CANDIDATE_A }),
        );
        assert.equal(candidateJobs.jobs.length, 1);
        assert.equal(candidateJobs.jobs[0].listingStatus, "closed");
        assert.equal(candidateJobs.jobs[0].notes, STATE_SENTINEL);
      },
    );

    await t.test(
      "refresh console rejects cross-origin and malformed form writes",
      async () => {
        const db = await mf.getD1Database("DB");
        const before = await db
          .prepare("SELECT COUNT(*) AS count FROM jobs")
          .first();
        const withoutOrigin = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          trustedMutation: false,
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "candidateId=x&answersRevision=y&payload=%7B%22jobs%22%3A%5B%5D%7D",
        });
        assert.equal(withoutOrigin.status, 403);

        const foreignOrigin = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://example.com",
            "sec-fetch-site": "cross-site",
          },
          body: "candidateId=x&answersRevision=y&payload=%7B%22jobs%22%3A%5B%5D%7D",
        });
        assert.equal(foreignOrigin.status, 403);

        const jsonBody = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: baseUrl.origin,
            "sec-fetch-site": "same-origin",
          },
          body: "{}",
        });
        assert.equal(jsonBody.status, 415);

        const malformed = new URLSearchParams({
          candidateId: candidateAId,
          answersRevision: candidateARevision,
          payload: JSON.stringify({
            candidateId: candidateAId,
            jobs: [],
          }),
          unexpected: "field",
        });
        const malformedBody = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: baseUrl.origin,
            "sec-fetch-site": "same-origin",
          },
          body: malformed.toString(),
        });
        assert.equal(malformedBody.status, 400);

        const duplicatePayload = new URLSearchParams({
          candidateId: candidateAId,
          answersRevision: candidateARevision,
          payload: JSON.stringify({ jobs: [] }),
        });
        duplicatePayload.append("payload", JSON.stringify({ jobs: [] }));
        const duplicateResponse = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: duplicatePayload.toString(),
        });
        assert.equal(duplicateResponse.status, 400);

        const multipartResponse = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=example",
          },
          body: "--example--",
        });
        assert.equal(multipartResponse.status, 415);

        const encodedResponse = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-encoding": "gzip",
          },
          body: "candidateId=x&answersRevision=y&payload=%7B%22jobs%22%3A%5B%5D%7D",
        });
        assert.equal(encodedResponse.status, 415);

        const oversizedBody = "x".repeat(6_100_001);
        const oversizedResponse = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": String(oversizedBody.length),
          },
          body: oversizedBody,
        });
        assert.equal(oversizedResponse.status, 413);

        const after = await db
          .prepare("SELECT COUNT(*) AS count FROM jobs")
          .first();
        assert.equal(after.count, before.count);
      },
    );

    await t.test(
      "success receipt requires the matching cookie and is consumed by the browser",
      async () => {
        const nakedReceipt =
          "00000000-0000-4000-8000-000000000001";
        const nakedResponse = await request(
          `/refresh-console?receipt=${nakedReceipt}`,
          { identity: OWNER },
        );
        assert.equal(nakedResponse.status, 200);
        assert.doesNotMatch(
          await nakedResponse.text(),
          /data-result-status="success"/,
        );

        const legacySavedQuery = await request(
          "/refresh-console?result=saved",
          { identity: OWNER },
        );
        assert.equal(legacySavedQuery.status, 200);
        assert.doesNotMatch(
          await legacySavedQuery.text(),
          /data-result-status="success"/,
        );

        const form = new URLSearchParams({
          candidateId: candidateBId,
          answersRevision: candidateBRevision,
          payload: JSON.stringify({
            activateRadar: false,
            closedRoles: [],
            jobs: [],
          }),
        });
        const postResponse = await request("/refresh-console", {
          identity: OWNER,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: baseUrl.origin,
            "sec-fetch-site": "same-origin",
          },
          body: form.toString(),
        });
        assert.equal(postResponse.status, 303);
        const destination = postResponse.headers.get("location");
        assert.ok(destination);
        const receiptCookie = cookiePair(
          postResponse.headers.get("set-cookie"),
        );

        const successfulGet = await request(destination, {
          identity: OWNER,
          headers: { cookie: receiptCookie },
        });
        assert.equal(successfulGet.status, 200);
        assert.match(
          await successfulGet.text(),
          /data-result-status="success"/,
        );
        const clearingCookie = successfulGet.headers.get("set-cookie");
        assert.match(clearingCookie ?? "", /Max-Age=0/i);

        const secondGet = await request(destination, { identity: OWNER });
        assert.equal(secondGet.status, 200);
        assert.doesNotMatch(
          await secondGet.text(),
          /data-result-status="success"/,
        );
      },
    );
  },
);
