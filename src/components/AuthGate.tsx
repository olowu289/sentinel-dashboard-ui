import type { ReactNode } from "react";
import { useSession } from "@/components/AuthProvider";
import { LoginView } from "@/components/LoginView";

/**
 * What the app renders before it renders the app.
 *
 * Three outcomes and no fourth:
 *
 *   checking      a near-silent hold. Never the app and never the login form,
 *                 because we do not yet know which is true, and flashing the
 *                 wrong one is worse than a beat of nothing.
 *   not unlocked  the login screen, INSTEAD of the app. This app never renders
 *                 half-authenticated.
 *   unlocked      the app.
 *
 * The gate sits above `SentinelApp`, so when it is closed nothing inside mounts
 * — which is the point rather than a detail. `App.tsx` starts three intervals
 * and, from Stage 3, will open peer connections on mount; an unauthenticated
 * tree doing any of that would fire 401s in a loop against a session that does
 * not exist.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, unlocked } = useSession();

  if (status === "checking") return <RestoringSession />;
  if (!unlocked) return <LoginView />;
  return <>{children}</>;
}

/**
 * Deliberately says almost nothing.
 *
 * It is on screen for as long as one request takes, and a splash that announces
 * itself would flash on every reload. No spinner for the same reason: at this
 * duration a spinner is a flicker, not information.
 */
function RestoringSession() {
  return (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-ink">
      <p className="font-display text-[0.75rem] tracking-[0.24em] text-muted uppercase">
        Restoring session
      </p>
    </div>
  );
}
