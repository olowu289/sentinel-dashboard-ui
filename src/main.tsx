import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TowerView } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TowerView />
  </StrictMode>,
);
