import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SentinelApp } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SentinelApp />
  </StrictMode>,
);
