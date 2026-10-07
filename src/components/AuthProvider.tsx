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
import { featureSet, type Feature } from "@/lib/features";
import { getAccount } from "@/lib/api/account";
import { updateStoredAccount } from "@/lib/api/auth";
import {
  clearSession,
  endSessionIfUnauthorized,
  getSession,
  loadSession,
  login as loginCall,
  logout as logoutCall,
  operatorName,
  refreshSession,
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
  /**
   * Which features this account may see. Derived from `account`, so it updates
   * the moment the stored account does — on sign-in, on a rename, and on the
   * refresh below.
   *
   * A SET rather than an array because every consumer asks "is this allowed",
   * and an array invites `.includes()` in a render loop over 40 components.
   */
  features: ReadonlySet<Feature>;
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

  /**
   * What this account may see. Recomputed from `account`, never stored
   * separately — two copies of this would drift, and the drifted one would be
   * the one deciding whether a customer sees the demo.
   */
  const features = useMemo(() => featureSet(account), [account]);

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
        if (session) {
          /* A session ARRIVING or being REPLACED. This used to `return`
             immediately, which was right while the only writer was sign-in (the
             sign-in path sets `account` itself). It is not right now that a
             rename replaces the stored account block: without this, the app
             keeps showing the OLD organization name until a reload, including
             on everything it stamps as authored. */
          setAccount(session.account);
          return;
        }
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
   * KEEPALIVE — slide the login session forward while it is actively in use, so
   * an operator on a long watch never hits coordination's hard TTL wall and gets
   * kicked to login mid-shift.
   *
   * Runs only while authenticated. It checks every few minutes and refreshes only
   * once the expiry is within a lead window, so it is nearly free (a handful of
   * calls a day) rather than a chatty poll. A refresh that comes back 401 means
   * the session is genuinely dead — `endSessionIfUnauthorized` ends it and the
   * gate drops to login; a transient failure is ignored and retried next tick, so
   * a coordination blip never logs anyone out. The server caps how far a session
   * can be slid (absolute lifetime from issue), so a truly idle tab still lapses.
   */
  useEffect(() => {
    if (status !== "authenticated") return;
    const REFRESH_LEAD_MS = 2 * 60 * 60 * 1000;  // refresh once <2h to expiry
    const CHECK_MS = 5 * 60 * 1000;              // re-check every 5 min
    let cancelled = false;
    const controller = new AbortController();
    const tick = async () => {
      const s = getSession();
      if (!s || cancelled) return;
      // Unknown expiry → refresh now to learn one; otherwise wait for the lead.
      const msLeft = s.expiresAt ? Date.parse(s.expiresAt) - Date.now() : 0;
      if (Number.isFinite(msLeft) && msLeft > REFRESH_LEAD_MS) return;
      try {
        const expiresAt = await refreshSession(s.ref, controller.signal);
        if (cancelled) return;
        const cur = getSession();
        if (cur && cur.ref === s.ref) saveSession({ ...cur, expiresAt });
      } catch (err) {
        if (cancelled) return;
        // Dead session (401) ends here; anything transient is left alone.
        endSessionIfUnauthorized(err);
      }
    };
    const id = window.setInterval(() => void tick(), CHECK_MS);
    void tick();  // check immediately on (re)authentication
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, [status]);

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

  /**
   * Refresh the feature list once, on load.
   *
   * The login response carries it, and `loadSession` restores that copy across
   * a reload — so this is not about getting a list, it is about getting a
   * CURRENT one. An operator who revokes a feature while somebody is signed in
   * should not have to wait for that person's session to lapse, and the stored
   * copy can be twelve hours old.
   *
   * ONE extra request on load, and deliberately NOT folded into the session
   * probe above: that probe is documented at length for using
   * `GET /v1/viewer/towers`, and a failure here must not be able to end a
   * session. Anything that goes wrong leaves the stored list in place, which is
   * the last thing the server actually said.
   */
  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const fresh = await getAccount(controller.signal);
        if (controller.signal.aborted) return;
        /* Through the store, so `account` and sessionStorage stay one copy. */
        updateStoredAccount(fresh);
      } catch (err) {
        if (controller.signal.aborted) return;
        /* A dead session still has to end the session — that is the one
           failure here that is not cosmetic. Everything else is left alone. */
        endSessionIfUnauthorized(err);
        console.debug("[auth] could not refresh features:", err);
      }
    })();
    return () => controller.abort();
    /* Keyed on the account id, not on `account`: `updateStoredAccount` replaces
       the object, so depending on `account` would re-fetch forever. */
  }, [status, account?.account_id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      features,
      endedReason,
      pending,
      operator: operatorName(account),
      signIn,
      signOut,
      unlocked: status === "authenticated",
    }),
    [status, account, features, endedReason, pending, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
