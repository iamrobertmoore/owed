import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";

/**
 * The Convex deployment URL is written to .env.local by `convex dev` and baked
 * into the bundle at build time. Static hosting serves this bundle from the
 * deployment's own site URL, so there is no server of ours to run.
 */
const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!url) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Run `npx convex dev` once to link this directory to a deployment.",
  );
}

const convex = new ConvexReactClient(url);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
);
