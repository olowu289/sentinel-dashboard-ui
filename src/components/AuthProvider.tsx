import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clearSession,
  getSession,
  loadSession,
  login as loginCall,
  logout as logoutCall,
  operatorName,
  resolveSession,
  saveSession,
  subscribeToSession,
  type AuthAccount,
  type SessionEndReason,
} from "@/lib/api/auth";

/**
 * Who is signed in, for the whole tree.
 *
 * This lives above `SentinelApp` rather than inside it, and the reason is
 * lifetime rather than tidiness. `App.tsx` owns *domain* state — feeds, alerts,
 * towers — whose life is one visit. A session outlives a reload, gates the
 * entire tree, and has to be readable before any domain fetch fires. Putting it
 * in `App.tsx`'s screen ternary would force every one of those booleans to also
 * encode "am I signed in", which is how that chain stops being readable.
 *
 * It is also the one Context in this app. Everything else is props, deliberately
 * — but a session is read at the top of the tree to decide what renders at all,
 * and threaded down for one string, and that is exactly what Context is for.
 */

export type AuthStatus =
  /** Resolving a stored session on load. Show nothing decisive yet. */
  | "checking"
  /** No session, and none recently lost. First visit, or a clean sign-out. */
  | "anonymous"
  /** Had a session; it lapsed or was revoked. Worth saying so. */
  | "ended"
  | "authenticated";

export interface AuthContextValue {
  status: AuthStatus;
  account: AuthAccount | null;
  /** Why the last session ended, when it ended on its own rather than by request. */
  endedReason: SessionEndReason | null;
  /** True while a sign-in is in flight. Drives the pending state. */
  pending: boolean;
  /** The name stamped on an authored act. See `operatorName` — it is the org. */
  operator: string;
  /**
   * Attempt a sign-in. The organization name is passed through VERBATIM.
   * Resolves on success; throws the typed auth errors on failure.
   */
  signIn: (organizationName: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** True when the app should render rather than the login screen. */
  unlocked: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useSession(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useSession must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [endedReason, setEndedReason] = useState<SessionEndReason | null>(null);
  const [pending, setPending] = useState(false);

  /* A synchronous latch on sign-in. `pending` is state, so three clicks
     dispatched in one tick all read the same stale `false` and all three issue
     a POST — which a probe caught doing exactly that. A ref is read and written
     in the same tick, so it actually holds. `pending` stays, for display. */
  const inFlight = useRef<Promise<void> | null>(null);

  /**
   * Resolve a stored session on load.
   *
   * Three outcomes, kept apart rather than collapsed:
   *
   *   nothing stored         → anonymous. Never signed in on this tab.
   *   stored but rejected    → ended. Had one; it lapsed or was revoked.
   *   stored but unreachable → KEPT, and reported by whatever tried to load.
   *                            Signing somebody out because the server is down
   *                            is an authentication verdict we did not get.
   *
   * That third branch is the one worth being careful about. A network blip on
   * page load must not look like a revocation.
   *
   * ── THE STRICTMODE TRAP, AND IT IS NOT THEORETICAL ─────────────────────
   *
   * `controller.signal.aborted` is the authority here, checked after the await
   * AND inside the catch, and the catch is the half that is easy to get wrong.
   *
   * StrictMode mounts, cleans up and remounts. The cleanup calls `abort()`,
   * which makes the in-flight probe reject with an abort error — and an abort
   * is not an authentication verdict, not a network failure, and not ours to
   * interpret. It is our own teardown. An earlier version of this catch treated
   * it as "unreachable, keep the session", so a REVOKED session restored to a
   * fully rendered app: the probe was aborted before its 401 landed, the catch
   * read that as a connection blip, and the operator got the fleet on a
   * credential the server had already rejected. A probe caught it; the fix is
   * to return without touching status and let the surviving run decide.
   *
   * A shared `alive` ref cannot do this job, which is why there isn't one: the
   * second run sets it back to true, which un-guards the first run's late
   * handlers. The controller is per-run and therefore unambiguous, and it is
   * aborted by a real unmount as well as by a StrictMode remount — so it covers
   * both cases with one check.
   */
  useEffect(() => {
    const controller = new AbortController();
    const gone = () => controller.signal.aborted;

    void (async () => {
      const stored = loadSession();
      if (!stored) {
        if (!gone()) setStatus("anonymous");
        return;
      }

      /* Show whose session is being restored while the probe is open. It is the
         truth already on disk, and it beats a nameless spinner. */
      if (!gone()) setAccount(stored.account);

      try {
        const ok = await resolveSession(controller.signal);
        if (gone()) return;

        if (ok) {
          setStatus("authenticated");
          return;
        }
        clearSession("expired");
        setAccount(null);
        setEndedReason("expired");
        setStatus("ended");
      } catch {
        /* Our own abort. Say nothing — the run that replaced us owns the
           answer, and guessing here is how a revoked session gets restored. */
        if (gone()) return;
        /* A genuine failure to reach coordination. NOT an authentication
           answer, so the session is kept and the screens below report the
           connection honestly. Signing somebody out because the server is down
           is a verdict we did not get. */
        setStatus("authenticated");
      }
    })();

    return () => controller.abort();
  }, []);

  /**
   * A 401 on ANY authenticated call clears the store and lands here.
   *
   * `endSessionIfUnauthorized` in `api/auth.ts` is the single place that fires
   * it, so every coordination call in the app gets the same behaviour: the
   * store empties, this hears it, and the gate drops to login in one move. A
   * revoked session can never leave a half-authenticated screen up.
   */
  useEffect(
    () =>
      subscribeToSession((session, reason) => {
        if (session) return;
        setAccount(null);
        if (reason && reason !== "logged_out") {
          setEndedReason(reason);
          setStatus("ended");
        } else {
          setEndedReason(null);
          setStatus("anonymous");
        }
      }),
    [],
  );

  /**
   * Attempt a sign-in.
   *
   * Idempotent while one is open: a second call joins the in-flight promise
   * rather than issuing a second POST. The guard is the `inFlight` ref rather
   * than `pending`, because `pending` is state — three clicks in one tick all
   * see the stale value and all three would post. Every caller still gets the
   * same resolution or the same rejection, so nothing has to know it was
   * coalesced.
   */
  const signIn = useCallback(
    (organizationName: string, password: string): Promise<void> => {
      if (inFlight.current) return inFlight.current;

      const attempt = async () => {
        setPending(true);
        try {
          // VERBATIM. No trim, no case fold — see `api/auth.ts`.
          const session = await loginCall(organizationName, password);
          saveSession(session);
          setAccount(session.account);
          setEndedReason(null);
          setStatus("authenticated");
        } finally {
          /* Cleared even when the call threw, so a failed attempt does not
             leave the button disabled forever, and the next one is not
             swallowed by a latch that never opened. */
          setPending(false);
          inFlight.current = null;
        }
      };

      /* `attempt()` runs synchronously as far as its first await, so the ref is
         set before any other click can be dispatched. */
      const running = attempt();
      inFlight.current = running;
      return running;
    },
    [],
  );

  const signOut = useCallback(async () => {
    const stored = getSession();
    if (stored) {
      /* Best effort. The local session is cleared either way — refusing to sign
         out because the server is unreachable would strand the operator in a
         session they have asked to leave. */
      await logoutCall(stored.ref).catch(() => false);
    }
    clearSession("logged_out");
    setAccount(null);
    setEndedReason(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      endedReason,
      pending,
      operator: operatorName(account),
      signIn,
      signOut,
      unlocked: status === "authenticated",
    }),
    [status, account, endedReason, pending, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
