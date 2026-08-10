import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

async function sourceFiles(directory) {
  const base = fileURLToPath(new URL(directory, root));
  const paths = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else paths.push(child);
    }
  }
  await walk(base);
  return paths;
}

test("ships no private identity or production seed data", async () => {
  const files = [
    ...(await sourceFiles("app/")),
    ...(await sourceFiles("db/")),
    ...(await sourceFiles("lib/")),
    ...(await sourceFiles("docs/")),
  ];
  for (const file of files) {
    const value = await readFile(file, "utf8");
    const emails = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    assert.deepEqual(
      emails,
      [],
      `${relative(fileURLToPath(root), file)} must not contain a committed identity`,
    );
  }

  assert.deepEqual(JSON.parse(await text("package.json")).name, "role-radar-starter");
  assert.match(await text("db/seed.ts"), /SEED_JOBS: JobSeed\[\] = \[\]/);
  assert.doesNotMatch(await text("db/schema.ts"), /candidate_id"\)\.notNull\(\)\.default/);
});

test("bootstraps a default-deny, environment-configured access roster", async () => {
  const runtime = await text("db/runtime.ts");
  assert.match(runtime, /BOOTSTRAP_OWNER_EMAIL/);
  assert.match(runtime, /BOOTSTRAP_CANDIDATE_EMAILS/);
  assert.match(runtime, /candidate_access/);
  assert.match(runtime, /status = 'active'/);
  assert.match(runtime, /role = 'owner' AND status = 'active'/);
  assert.match(runtime, /if \(existingOwner\) return/);
  assert.match(runtime, /access\.role === "owner"/);
  assert.doesNotMatch(runtime, /PILOT_ACCESS|allowLegacyUnprefixedIds/);
});

test("trusts Sites identity headers only behind an explicit provider gate", async () => {
  const auth = await text("app/chatgpt-auth.ts");
  assert.match(auth, /AUTH_PROVIDER/);
  assert.match(auth, /TRUSTED_AUTH_PROVIDER = "openai-sites"/);
  assert.match(auth, /provider !== TRUSTED_AUTH_PROVIDER\) return null/);
  assert.ok(
    auth.indexOf("provider !== TRUSTED_AUTH_PROVIDER") <
      auth.indexOf("await headers()"),
    "the provider gate must fail closed before authenticated headers are read",
  );
});

test("keeps refresh writes candidate-scoped and strictly namespaced", async () => {
  const runtime = await text("db/runtime.ts");
  const route = await text("app/api/refresh/jobs/route.ts");
  assert.match(runtime, /return `\$\{candidateId\}\$\{CANDIDATE_JOB_ID_SEPARATOR\}\$\{sourceJobId\}`/);
  assert.match(runtime, /WHERE jobs\.candidate_id = excluded\.candidate_id/);
  assert.match(route, /getCandidateRefreshContext\(db, candidateId\)/);
  assert.match(route, /buildCandidateJobId\(candidateId, sourceJobId\)/);
  assert.doesNotMatch(route, /legacy|allowLegacy|candidate_id = '[^']+'/i);
});

test("keeps application state bound to the authenticated candidate", async () => {
  const jobsRoute = await text("app/api/jobs/route.ts");
  assert.match(jobsRoute, /j\.candidate_id = \?/);
  assert.match(jobsRoute, /id = \? AND candidate_id = \?/);
  assert.match(jobsRoute, /user\.userId/);
});

test("bounds JSON APIs and applies private anti-framing headers globally", async () => {
  const httpSecurity = await text("lib/http-security.ts");
  const securityHeaders = await text("lib/security-headers.ts");
  const worker = await text("worker/index.ts");
  const jobsRoute = await text("app/api/jobs/route.ts");
  const profileRoute = await text("app/api/profile/route.ts");
  const refreshRoute = await text("app/api/refresh/jobs/route.ts");

  assert.match(httpSecurity, /request\.body\.getReader\(\)/);
  assert.match(httpSecurity, /application\/json/);
  assert.match(httpSecurity, /content-length/);
  assert.match(httpSecurity, /content-encoding/);
  assert.match(httpSecurity, /status: 413/);
  assert.match(jobsRoute, /readBoundedJson\(request, MAX_JOB_STATE_BODY_BYTES\)/);
  assert.match(profileRoute, /readBoundedJson\(request, MAX_PROFILE_BODY_BYTES\)/);
  assert.match(refreshRoute, /readBoundedJson\(request, MAX_REFRESH_BODY_BYTES\)/);
  assert.doesNotMatch(jobsRoute, /request\.json\(\)/);
  assert.doesNotMatch(profileRoute, /request\.json\(\)/);
  assert.doesNotMatch(refreshRoute, /request\.json\(\)/);

  assert.match(securityHeaders, /"Cache-Control": "private, no-store"/);
  assert.match(securityHeaders, /"X-Content-Type-Options": "nosniff"/);
  assert.match(securityHeaders, /"X-Frame-Options": "DENY"/);
  assert.match(securityHeaders, /"frame-ancestors 'none'"/);
  assert.match(worker, /withPrivateSecurityHeaders\(response\)/);
});
