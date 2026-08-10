import { NextRequest, NextResponse } from "next/server";
import { PRIVATE_SECURITY_HEADERS } from "./security-headers";

export function applyPrivateSecurityHeaders<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(PRIVATE_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function privateJson(
  body: unknown,
  init: ResponseInit = {},
): NextResponse {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(PRIVATE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return NextResponse.json(body, { ...init, headers });
}

/**
 * Browser mutations must originate from this exact origin. JSON content types
 * normally trigger a CORS preflight, but an explicit origin gate keeps the
 * boundary fail-closed if surrounding proxy or CORS behavior changes.
 */
export function isTrustedMutationRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (parsedOrigin.origin !== new URL(request.url).origin) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite.toLowerCase() === "same-origin";
}

type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

export async function readBoundedJson(
  request: NextRequest,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: privateJson(
        { error: "Content-Type must be application/json." },
        { status: 415 },
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
      response: privateJson(
        { error: "Encoded request bodies are not accepted." },
        { status: 415 },
      ),
    };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) {
      return {
        ok: false,
        response: privateJson({ error: "Invalid request length." }, { status: 400 }),
      };
    }
    if (Number(declaredLength) > maxBytes) {
      return {
        ok: false,
        response: privateJson({ error: "Request body is too large." }, { status: 413 }),
      };
    }
  }

  if (!request.body) {
    return {
      ok: false,
      response: privateJson({ error: "Request body is required." }, { status: 400 }),
    };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          response: privateJson(
            { error: "Request body is too large." },
            { status: 413 },
          ),
        };
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return {
      ok: false,
      response: privateJson({ error: "Request body is invalid." }, { status: 400 }),
    };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      response: privateJson({ error: "Invalid JSON request." }, { status: 400 }),
    };
  }
}
