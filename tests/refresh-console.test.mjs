import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

test("provides an owner-only Browser-native refresh console", async () => {
  const route = await text("app/refresh-console/route.ts");
  const authorization = await text("app/api/refresh/authorization.ts");

  assert.match(route, /authorizeRefreshOwner/);
  assert.match(authorization, /ownerAccess\?\.role !== "owner"/);
  assert.match(route, /method="post" action="\$\{CONSOLE_PATH\}"/);
  assert.match(route, /name="candidateId"/);
  assert.match(route, /name="answersRevision"/);
  assert.match(route, /name="payload"/);
  assert.match(route, /Candidate refresh saved/);
  assert.match(route, /redirect\(destination, 303\)/);
  assert.match(route, /crypto\.randomUUID\(\)/);
  assert.match(route, /__Host-role-radar-refresh-receipt/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /secure: true/);
  assert.match(route, /sameSite: "strict"/);
  assert.match(route, /path: "\/"/);
  assert.match(route, /hasValidSuccessReceipt\(request\)/);
  assert.match(route, /queryReceipt === cookieReceipt/);
  assert.doesNotMatch(route, /searchParams\.get\("result"\) === "saved"/);
  assert.doesNotMatch(route, /fetch\(|XMLHttpRequest|bypass.?token/i);
});

test("bounds and validates native form submissions", async () => {
  const route = await text("app/refresh-console/route.ts");
  assert.match(route, /application\/x-www-form-urlencoded/);
  assert.match(route, /MAX_ENCODED_FORM_BYTES/);
  assert.match(route, /request\.body\.getReader\(\)/);
  assert.match(route, /content-length/);
  assert.match(route, /content-encoding/);
  assert.match(route, /FORM_FIELDS = new Set\(\["candidateId", "answersRevision", "payload"\]\)/);
  assert.match(route, /Sec-Fetch-Site|sec-fetch-site/);
  assert.match(route, /Origin|origin/);
  assert.match(route, /Content-Security-Policy/);
  assert.match(route, /frame-ancestors 'none'/);
  assert.match(route, /private, no-store/);
});
