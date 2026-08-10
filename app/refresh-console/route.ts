import { NextRequest, NextResponse } from "next/server";
import {
  listCandidateRefreshContexts,
  type CandidateRefreshContext,
} from "../../db/refresh";
import { chatGPTSignInPath } from "../chatgpt-auth";
import { authorizeRefreshOwner } from "../api/refresh/authorization";
import { ingestCandidateJobRefresh } from "../api/refresh/jobs/route";

export const dynamic = "force-dynamic";

const CONSOLE_PATH = "/refresh-console";
const SUCCESS_RECEIPT_COOKIE = "__Host-role-radar-refresh-receipt";
const SUCCESS_RECEIPT_MAX_AGE_SECONDS = 120;
const MAX_FORM_PAYLOAD_LENGTH = 1_500_000;
const MAX_ENCODED_FORM_BYTES = 6_100_000;
const MAX_CANDIDATE_ID_LENGTH = 200;
const MAX_REVISION_LENGTH = 100;
const FORM_FIELDS = new Set(["candidateId", "answersRevision", "payload"]);
const PAYLOAD_KEYS = new Set(["activateRadar", "closedRoles", "jobs"]);

type RefreshApiResult = {
  error?: string;
};

type ParsedRefreshForm = {
  candidateId: string;
  answersRevision: string;
  fragment: Record<string, unknown>;
};

type FormReadResult =
  | { ok: true; value: ParsedRefreshForm }
  | { ok: false; response: NextResponse };

export async function GET(request: NextRequest) {
  try {
    const authorization = await authorizeRefreshOwner();
    if (!authorization.ok) {
      return accessFailurePage(authorization.response.status);
    }

    const result = await listCandidateRefreshContexts(authorization.db);
    const generatedAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      generatedAt,
      candidates: result.candidates,
      meta: {
        eligibleCandidateCount: result.candidates.length,
        skippedInvalidProfileCount: result.skippedInvalidProfiles,
      },
    };

    const response = htmlResponse(
      renderConsolePage(
        payload,
        generatedAt,
        hasValidSuccessReceipt(request),
      ),
      200,
    );
    clearSuccessReceipt(response);
    return response;
  } catch (error) {
    console.error("Unable to render the refresh console", error);
    return htmlResponse(
      renderMessagePage({
        title: "Refresh console unavailable",
        eyebrow: "Temporary error",
        message:
          "The candidate context could not be loaded. Return to the console and try again.",
        status: "error",
      }),
      500,
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isTrustedFormRequest(request)) {
    return htmlResponse(
      renderMessagePage({
        title: "Refresh not saved",
        eyebrow: "Request rejected",
        message:
          "The refresh console accepts writes only from its own signed-in page.",
        status: "error",
      }),
      403,
    );
  }

  try {
    const authorization = await authorizeRefreshOwner();
    if (!authorization.ok) {
      return accessFailurePage(authorization.response.status);
    }

    const parsedForm = await readRefreshForm(request);
    if (!parsedForm.ok) return parsedForm.response;

    const { candidateId, answersRevision, fragment } = parsedForm.value;
    const ingestionResponse = await ingestCandidateJobRefresh(
      authorization.db,
      {
        candidateId,
        answersRevision,
        activateRadar: fragment.activateRadar === true,
        closedRoles: fragment.closedRoles ?? [],
        jobs: fragment.jobs,
      },
    );

    if (!ingestionResponse.ok) {
      const result = await readApiResult(ingestionResponse);
      return htmlResponse(
        renderMessagePage({
          title: "Refresh not saved",
          eyebrow:
            ingestionResponse.status === 409
              ? "Criteria changed"
              : "Validation error",
          message:
            result.error ??
            "The candidate refresh was rejected. Reload the context and correct the payload before retrying.",
          status: "error",
          details:
            ingestionResponse.status === 409
              ? "Reload the console before recomputing this candidate. No changes from this submission were saved."
              : undefined,
        }),
        ingestionResponse.status,
      );
    }

    const receipt = crypto.randomUUID();
    const destination = new URL(CONSOLE_PATH, request.url);
    destination.searchParams.set("receipt", receipt);
    const response = NextResponse.redirect(destination, 303);
    response.cookies.set({
      name: SUCCESS_RECEIPT_COOKIE,
      value: receipt,
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: SUCCESS_RECEIPT_MAX_AGE_SECONDS,
    });
    applyPrivateResponseHeaders(response);
    return response;
  } catch (error) {
    console.error("Unable to process the refresh console submission", error);
    return htmlResponse(
      renderMessagePage({
        title: "Refresh not saved",
        eyebrow: "Temporary error",
        message:
          "The candidate refresh could not be saved. Reload the console and try again.",
        status: "error",
      }),
      500,
    );
  }
}

async function readRefreshForm(request: NextRequest): Promise<FormReadResult> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return {
      ok: false,
      response: invalidPayloadPage(
        "The refresh console accepts only its native URL-encoded form.",
        415,
      ),
    };
  }

  const contentEncoding = request.headers
    .get("content-encoding")
    ?.trim()
    .toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    return {
      ok: false,
      response: invalidPayloadPage(
        "Encoded request bodies are not accepted by the refresh console.",
        415,
      ),
    };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) {
      return {
        ok: false,
        response: invalidPayloadPage("Invalid request length.", 400),
      };
    }
    if (Number(declaredLength) > MAX_ENCODED_FORM_BYTES) {
      return {
        ok: false,
        response: invalidPayloadPage("The submitted form is too large.", 413),
      };
    }
  }

  if (!request.body) {
    return {
      ok: false,
      response: invalidPayloadPage("The submitted form is empty.", 400),
    };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let encodedForm = "";
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_ENCODED_FORM_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          response: invalidPayloadPage("The submitted form is too large.", 413),
        };
      }
      encodedForm += decoder.decode(value, { stream: true });
    }
    encodedForm += decoder.decode();
  } catch {
    return {
      ok: false,
      response: invalidPayloadPage("The submitted form could not be read.", 400),
    };
  }

  const form = new URLSearchParams(encodedForm);
  const entries = [...form.entries()];
  if (
    entries.length !== FORM_FIELDS.size ||
    entries.some(([key]) => !FORM_FIELDS.has(key)) ||
    [...FORM_FIELDS].some((key) => form.getAll(key).length !== 1)
  ) {
    return {
      ok: false,
      response: invalidPayloadPage(
        "Submit exactly one candidate, revision, and JSON payload.",
        400,
      ),
    };
  }

  const candidateId = form.get("candidateId")?.trim() ?? "";
  const answersRevision = form.get("answersRevision")?.trim() ?? "";
  const payload = form.get("payload")?.trim() ?? "";
  if (
    !candidateId ||
    candidateId.length > MAX_CANDIDATE_ID_LENGTH ||
    candidateId.includes("::") ||
    !answersRevision ||
    answersRevision.length > MAX_REVISION_LENGTH ||
    !payload ||
    payload.length > MAX_FORM_PAYLOAD_LENGTH
  ) {
    return {
      ok: false,
      response: invalidPayloadPage(
        `Provide one candidate refresh payload under ${MAX_FORM_PAYLOAD_LENGTH.toLocaleString("en-IN")} characters.`,
        payload.length > MAX_FORM_PAYLOAD_LENGTH ? 413 : 400,
      ),
    };
  }

  let fragment: unknown;
  try {
    fragment = JSON.parse(payload);
  } catch {
    return {
      ok: false,
      response: invalidPayloadPage("Provide valid JSON for this candidate.", 400),
    };
  }

  if (
    !isPlainRecord(fragment) ||
    Object.keys(fragment).some((key) => !PAYLOAD_KEYS.has(key)) ||
    !Array.isArray(fragment.jobs) ||
    (fragment.closedRoles !== undefined &&
      !Array.isArray(fragment.closedRoles)) ||
    (fragment.activateRadar !== undefined &&
      typeof fragment.activateRadar !== "boolean")
  ) {
    return {
      ok: false,
      response: invalidPayloadPage(
        "The JSON may contain only activateRadar, closedRoles, and jobs.",
        400,
      ),
    };
  }

  return {
    ok: true,
    value: { candidateId, answersRevision, fragment },
  };
}

async function readApiResult(response: NextResponse): Promise<RefreshApiResult> {
  try {
    const body: unknown = await response.json();
    return isPlainRecord(body) ? (body as RefreshApiResult) : {};
  } catch {
    return {};
  }
}

function invalidPayloadPage(message: string, status: number): NextResponse {
  return htmlResponse(
    renderMessagePage({
      title: "Refresh not saved",
      eyebrow:
        status === 413
          ? "Payload too large"
          : status === 415
            ? "Unsupported request"
            : "Invalid payload",
      message,
      status: "error",
    }),
    status,
  );
}

function accessFailurePage(status: number): NextResponse {
  const signedOut = status === 401;
  return htmlResponse(
    renderMessagePage({
      title: signedOut ? "Owner sign-in required" : "Owner access required",
      eyebrow: "Private research console",
      message: signedOut
        ? "Sign in with the Role Radar owner account before loading or writing candidate research."
        : "This account may use its own candidate radar but cannot read or update other candidates.",
      status: "error",
      actionHref: signedOut ? chatGPTSignInPath(CONSOLE_PATH) : "/",
      actionLabel: signedOut ? "Sign in" : "Return to Role Radar",
    }),
    status,
  );
}

function renderConsolePage(
  payload: {
    schemaVersion: number;
    generatedAt: string;
    candidates: CandidateRefreshContext[];
    meta: Record<string, number>;
  },
  generatedAt: string,
  saved: boolean,
): string {
  const contextJson = JSON.stringify(payload, null, 2);
  const candidateCount = payload.candidates.length;
  const forms = payload.candidates
    .map((candidate, index) => renderCandidateForm(candidate, index))
    .join("");

  return documentShell(`
    <main class="console-shell" data-page="refresh-console">
      <header class="console-header">
        <a class="brand" href="/" aria-label="Return to Role Radar">
          <span class="brand-mark" aria-hidden="true">RR</span>
          <span><strong>Role Radar</strong><small>Owner research console</small></span>
        </a>
        <a class="secondary-action" href="${CONSOLE_PATH}">Reload context</a>
      </header>

      ${
        saved
          ? `<aside class="success-banner" data-result-status="success" role="status"><strong>Candidate refresh saved</strong><span>D1 was updated. Application statuses and notes were not read or changed.</span></aside>`
          : ""
      }

      <section class="console-hero" aria-labelledby="console-title">
        <p class="eyebrow">Browser-compatible refresh bridge</p>
        <h1 id="console-title">Research from rendered context. Save through candidate-isolated forms.</h1>
        <p>
          ${candidateCount} eligible candidate${candidateCount === 1 ? "" : "s"} at
          <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time>.
          Read the context below, research each candidate independently, and submit only that candidate's jobs and closures.
        </p>
      </section>

      <section class="console-grid">
        <article class="console-card context-card" aria-labelledby="context-title">
          <div class="card-heading">
            <div>
              <p class="step-label">Step 1</p>
              <h2 id="context-title">Candidate refresh context</h2>
            </div>
            <span class="count-badge">${candidateCount}</span>
          </div>
          <p class="card-copy">
            This is the authoritative, owner-only context. Preserve every existing firstSeenAt and use each candidate's exact answersRevision.
          </p>
          <pre id="refresh-context-json" data-testid="refresh-context-json">${escapeHtml(contextJson)}</pre>
        </article>

        <section class="candidate-forms" aria-label="Candidate refresh forms">
          ${
            forms ||
            `<article class="console-card empty-card"><p class="step-label">No eligible profiles</p><h2>Nothing to refresh</h2><p class="card-copy">Complete an invited candidate's onboarding before running research.</p></article>`
          }
        </section>
      </section>
    </main>
  `);
}

function renderCandidateForm(
  candidate: CandidateRefreshContext,
  index: number,
): string {
  const formId = `candidate-refresh-${index + 1}`;
  const contextId = `refresh-context-${index + 1}`;
  const candidateJson = JSON.stringify(candidate, null, 2);
  return `
    <article class="console-card submit-card" data-candidate-id="${escapeHtml(candidate.candidateId)}">
      <div class="card-heading">
        <div>
          <p class="step-label">Step ${index + 2}</p>
          <h2>${escapeHtml(candidate.displayName)}</h2>
        </div>
        <span class="persona-badge">${escapeHtml(candidate.persona)}</span>
      </div>
      <p class="card-copy">
        ${escapeHtml(candidate.target.titles.join(", ") || "Candidate-specific roles")}. Identity and revision are fixed by this form.
      </p>
      <pre id="${contextId}" class="candidate-context" data-candidate-context="${escapeHtml(candidate.candidateId)}">${escapeHtml(candidateJson)}</pre>
      <form method="post" action="${CONSOLE_PATH}" accept-charset="UTF-8">
        <input type="hidden" name="candidateId" value="${escapeHtml(candidate.candidateId)}" />
        <input type="hidden" name="answersRevision" value="${escapeHtml(candidate.answersRevision)}" />
        <label for="${formId}">Jobs and closures JSON for ${escapeHtml(candidate.displayName)}</label>
        <textarea
          id="${formId}"
          name="payload"
          rows="24"
          maxlength="${MAX_FORM_PAYLOAD_LENGTH}"
          required
          spellcheck="false"
          autocomplete="off"
          placeholder='{"activateRadar":true,"closedRoles":[],"jobs":[]}'
        ></textarea>
        <p class="form-note">Use only activateRadar, closedRoles and jobs. Never include candidate identity, application status or notes.</p>
        <button type="submit">Save ${escapeHtml(candidate.displayName)} refresh</button>
      </form>
    </article>
  `;
}

function renderMessagePage({
  title,
  eyebrow,
  message,
  status,
  details,
  actionHref = CONSOLE_PATH,
  actionLabel = "Return to refresh console",
}: {
  title: string;
  eyebrow: string;
  message: string;
  status: "success" | "error";
  details?: string;
  actionHref?: string;
  actionLabel?: string;
}): string {
  return documentShell(`
    <main class="result-shell" data-page="refresh-result" data-result-status="${status}">
      <section class="result-card ${status}" aria-labelledby="result-title">
        <span class="result-mark" aria-hidden="true">${status === "success" ? "✓" : "!"}</span>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1 id="result-title">${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${details ? `<p class="result-details">${escapeHtml(details)}</p>` : ""}
        <a class="primary-action" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>
      </section>
    </main>
  `);
}

function documentShell(content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Role Radar — owner refresh console</title>
    <style>
      :root{color-scheme:light;--ink:#172033;--muted:#687286;--paper:#f4f6f1;--card:#fff;--line:#dfe4da;--blue:#3152d5;--deep:#243b9d;--lime:#c8f45a;--mint:#dff7e8;--rose:#ffe4e7}*{box-sizing:border-box}body{min-width:320px;margin:0;color:var(--ink);background:radial-gradient(circle at 2% 0%,rgb(200 244 90 / .25),transparent 23rem),var(--paper);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.console-shell{width:min(1500px,100%);margin:0 auto;padding:24px clamp(18px,4vw,64px) 64px}.console-header{display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:inline-flex;gap:11px;align-items:center;text-decoration:none}.brand-mark{display:grid;width:38px;height:38px;place-items:center;border-radius:11px;color:#fff;background:var(--blue);font-size:12px;font-weight:850}.brand>span:last-child{display:flex;flex-direction:column}.brand strong{font-size:15px}.brand small{color:var(--muted);font-size:11px}.secondary-action,.primary-action{display:inline-flex;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;font-size:13px;font-weight:800;text-decoration:none}.primary-action{margin-top:22px;border-color:var(--blue);color:#fff;background:var(--blue)}.primary-action:hover{background:var(--deep)}.success-banner{display:flex;gap:8px;align-items:center;margin-top:28px;padding:14px 16px;border:1px solid #afd8bb;border-radius:14px;background:var(--mint);font-size:13px}.success-banner span{color:#3f6550}.console-hero{max-width:850px;padding:64px 0 40px}.eyebrow,.step-label{margin:0 0 12px;color:var(--blue);font-size:12px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.console-hero h1,.result-card h1{margin:0;font-size:clamp(38px,6vw,72px);letter-spacing:-.055em;line-height:.98}.console-hero>p:last-child{max-width:760px;margin:24px 0 0;color:#4e596d;font-size:17px;line-height:1.6}.console-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(360px,.75fr);gap:22px;align-items:start}.candidate-forms{display:grid;gap:22px}.console-card{min-width:0;padding:24px;border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:0 14px 42px rgb(30 47 33 / .08)}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.card-heading h2,.empty-card h2{margin:0;font-size:24px;letter-spacing:-.035em}.step-label{margin-bottom:6px}.count-badge{display:grid;min-width:38px;height:38px;padding:0 10px;place-items:center;border-radius:999px;background:var(--lime);font-weight:850}.persona-badge{padding:6px 9px;border-radius:999px;background:#e8edff;color:var(--deep);font-size:11px;font-weight:850}.card-copy{margin:14px 0 18px;color:var(--muted);font-size:14px;line-height:1.5}pre{overflow:auto;max-height:72vh;margin:0;padding:18px;border:1px solid #d7ddec;border-radius:14px;background:#121827;color:#e9edff;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}.candidate-context{max-height:240px;margin-bottom:18px}form{display:grid;gap:10px}label{font-size:13px;font-weight:850}textarea{width:100%;min-height:370px;resize:vertical;padding:14px;border:1px solid #cbd2df;border-radius:12px;background:#fbfcff;color:var(--ink);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}textarea:focus{outline:3px solid rgb(49 82 213 / .22);border-color:var(--blue)}.form-note{margin:2px 0 8px;color:var(--muted);font-size:12px;line-height:1.45}button{min-height:46px;border:0;border-radius:11px;color:#fff;background:var(--blue);font:800 14px/1 Inter,ui-sans-serif,sans-serif;cursor:pointer}button:hover{background:var(--deep)}.result-shell{display:grid;min-height:100vh;padding:24px;place-items:center}.result-card{width:min(100%,680px);padding:clamp(30px,6vw,58px);border:1px solid var(--line);border-radius:26px;background:var(--card);box-shadow:0 14px 42px rgb(30 47 33 / .08)}.result-card h1{font-size:clamp(38px,6vw,62px)}.result-card>p:not(.eyebrow){margin:20px 0 0;color:#4e596d;font-size:16px;line-height:1.55}.result-card .result-details{color:var(--muted);font-size:14px}.result-mark{display:grid;width:48px;height:48px;margin-bottom:30px;place-items:center;border-radius:14px;background:var(--mint);font-size:24px;font-weight:900}.result-card.error .result-mark{background:var(--rose)}@media(max-width:900px){.console-grid{grid-template-columns:1fr}.console-hero{padding-top:52px}pre{max-height:52vh}.success-banner{align-items:flex-start;flex-direction:column}}
    </style>
  </head>
  <body>${content}</body>
</html>`;
}

function htmlResponse(html: string, status: number): NextResponse {
  const response = new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
  applyPrivateResponseHeaders(response);
  return response;
}

function applyPrivateResponseHeaders(response: NextResponse): void {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function isTrustedFormRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null" || origin !== new URL(request.url).origin) {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite.toLowerCase() === "same-origin";
}

function hasValidSuccessReceipt(request: NextRequest): boolean {
  const queryReceipt = request.nextUrl.searchParams.get("receipt");
  const cookieReceipt = request.cookies.get(SUCCESS_RECEIPT_COOKIE)?.value;
  return Boolean(
    queryReceipt &&
      cookieReceipt &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        queryReceipt,
      ) &&
      queryReceipt === cookieReceipt,
  );
}

function clearSuccessReceipt(response: NextResponse): void {
  response.cookies.set({
    name: SUCCESS_RECEIPT_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
