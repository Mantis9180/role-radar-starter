import { NextResponse } from "next/server";
import {
  ensureJobDatabase,
  getOrCreateCandidateProfile,
  isCandidateAccessDeniedError,
} from "../../../db/runtime";
import { getChatGPTUser } from "../../chatgpt-auth";
import { privateJson } from "../../../lib/http-security";

type AuthorizedRefreshOwner = {
  ok: true;
  db: D1Database;
};

type RefreshAuthorizationFailure = {
  ok: false;
  response: NextResponse;
};

/**
 * Refresh APIs contain every opted-in candidate's search criteria, so ordinary
 * signed-in candidates must never be able to call them. Platform sign-in
 * authenticates the request; the owner profile supplies authorization.
 */
export async function authorizeRefreshOwner(): Promise<
  AuthorizedRefreshOwner | RefreshAuthorizationFailure
> {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      ok: false,
      response: privateJson({ error: "Sign in required" }, { status: 401 }),
    };
  }

  const db = await ensureJobDatabase();
  let caller;
  try {
    caller = await getOrCreateCandidateProfile(db, user);
  } catch (error) {
    if (!isCandidateAccessDeniedError(error)) throw error;
    return {
      ok: false,
      response: privateJson({ error: error.message }, { status: 403 }),
    };
  }
  const ownerAccess = await db
    .prepare(
      `SELECT role
       FROM candidate_access
       WHERE email = ? AND status = 'active'
       LIMIT 1`,
    )
    .bind(caller.email)
    .first<{ role: string }>();

  if (!caller.isOwner || ownerAccess?.role !== "owner") {
    return {
      ok: false,
      response: privateJson({ error: "Owner access required" }, { status: 403 }),
    };
  }

  return { ok: true, db };
}
