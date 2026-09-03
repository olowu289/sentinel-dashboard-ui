import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SentinelApp } from "./App";
import { AuthGate } from "./components/AuthGate";
import { AuthProvider } from "./components/AuthProvider";
import "./index.css";

/* The gate sits ABOVE the app, not inside it. Session state has a different
   lifetime from domain state — it survives a reload and decides what renders at
   all — and while the gate is closed nothing inside mounts, so an
   unauthenticated tree never starts App's intervals or fires a call against a
   session that does not exist.

   StrictMode stays. It double-invokes effects in development, which is exactly
   the pressure the session probe and (from Stage 3) the peer connections have
   to survive; removing it would hide the bug rather than fix it. The guards are
   in `AuthProvider` — an AbortController plus an `alive` ref. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <SentinelApp />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);
