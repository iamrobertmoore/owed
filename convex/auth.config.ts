import type { AuthConfig } from "convex/server";

/**
 * Convex Auth. The deployment's own site URL is the issuer, so there is no
 * third-party identity provider to configure and no external account to create.
 *
 * The check is explicit because the failure mode without it is a push that dies
 * with "empty host", which says nothing about the actual cause. On a hosted
 * deployment Convex sets CONVEX_SITE_URL for you. On a self-hosted backend it
 * comes from the container's CONVEX_SITE_ORIGIN.
 */
const siteUrl = process.env.CONVEX_SITE_URL;
if (!siteUrl) {
  throw new Error(
    "CONVEX_SITE_URL is not set on this deployment, so Convex Auth has no issuer. " +
      "Hosted deployments set it automatically; self-hosted backends need CONVEX_SITE_ORIGIN.",
  );
}

export default {
  providers: [
    {
      domain: siteUrl,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
