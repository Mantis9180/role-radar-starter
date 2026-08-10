import { listCandidateRefreshContexts } from "../../../../db/refresh";
import { privateJson } from "../../../../lib/http-security";
import { authorizeRefreshOwner } from "../authorization";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authorization = await authorizeRefreshOwner();
    if (!authorization.ok) return authorization.response;

    const result = await listCandidateRefreshContexts(authorization.db);
    return privateJson(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        candidates: result.candidates,
        meta: {
          eligibleCandidateCount: result.candidates.length,
          skippedInvalidProfileCount: result.skippedInvalidProfiles,
        },
      },
    );
  } catch (error) {
    console.error("Unable to build the candidate refresh context", error);
    return privateJson(
      { error: "Refresh context unavailable" },
      { status: 500 },
    );
  }
}
