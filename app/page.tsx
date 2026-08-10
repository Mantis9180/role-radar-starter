import { chatGPTSignOutPath, requireChatGPTUser } from "./chatgpt-auth";
import { CandidateOnboarding } from "./CandidateOnboarding";
import { JobRadar } from "./JobRadar";
import {
  ensureCandidateProfile,
  isCandidateAccessDeniedError,
  type CandidateProfile,
} from "../db/runtime";
import { parseRadarCandidateContext } from "../lib/candidate-profile";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  const signOutUrl = chatGPTSignOutPath("/");
  let profile: CandidateProfile;
  try {
    profile = await ensureCandidateProfile(user);
  } catch (error) {
    if (!isCandidateAccessDeniedError(error)) throw error;
    return (
      <main className="access-denied-shell">
        <section className="access-denied-card" aria-labelledby="access-title">
          <span className="brand-mark" aria-hidden="true">
            RR
          </span>
          <p className="eyebrow">Private pilot</p>
          <h1 id="access-title">This account has not been invited yet.</h1>
          <p>
            Role Radar is currently limited to approved candidates. You are
            signed in as <strong>{user.email}</strong>.
          </p>
          <p className="access-denied-note">
            Sign out and use an invited email address, or ask the Role Radar
            owner to add this account to the access roster.
          </p>
          <a className="access-denied-action" href={signOutUrl}>
            Sign out and switch account
          </a>
        </section>
      </main>
    );
  }

  const canViewRadar =
    profile.onboardingStatus === "complete" &&
    (profile.isOwner || profile.radarStatus === "active");
  const radarContext = parseRadarCandidateContext(profile.answersJson, "PM");

  if (!canViewRadar) {
    return (
      <CandidateOnboarding
        profile={profile}
        signOutUrl={signOutUrl}
      />
    );
  }

  return (
    <JobRadar
      displayName={user.displayName}
      email={user.email}
      signOutUrl={signOutUrl}
      isOwner={profile.isOwner}
      persona={radarContext.persona}
      preferredLocations={radarContext.preferredLocations}
      strengths={radarContext.strengths}
    />
  );
}
