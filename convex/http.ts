import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { auth } from "./auth";

const http = httpRouter();

// Convex Auth's own endpoints.
auth.addHttpRoutes(http);

/**
 * The agent's inbound mail.
 *
 * AgentMail signs every delivery with Svix and the component verifies it and
 * deduplicates by event id before this handler runs, so a replayed delivery
 * cannot double-post a reply onto a claim.
 */
const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.inboxes.onMessageReceived,
});

/**
 * The component's published types were built against convex ^1.24.8, where the
 * `runMutation` it declares took its options argument differently from the one
 * on a 1.45 action context. The runtime shapes are identical and `handleWebhook`
 * only ever calls it as `ctx.runMutation(ref, args)`, so this is a narrow cast
 * with the reason attached rather than a blanket `any`.
 */
type WebhookCtx = Parameters<typeof agentmail.handleWebhook>[0];

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) =>
    agentmail.handleWebhook(ctx as unknown as WebhookCtx, req),
  ),
});

/**
 * Firecrawl's crawl webhooks are mounted by the component itself at the prefix
 * configured in convex.config.ts, so there is nothing to add here. The route
 * exists only when FIRECRAWL_WEBHOOK_SECRET is set; without it, crawls fall
 * back to polling, which is what local development uses.
 */

/**
 * The built front end, served from this deployment's own root.
 *
 * `convex.config.ts` mounts staticHosting without an `httpPrefix`, which puts
 * the app in charge of HTTP routing and makes this call the thing that actually
 * serves the site. Without it the component holds the uploaded files and
 * nothing routes to them, so every path answers "No matching routes found",
 * which reads as a missing deploy rather than a missing route.
 *
 * The component's own handler is the faster default, but it would have to own
 * the root prefix, and two routes here cannot move: `/agentmail/webhook` is
 * registered with AgentMail as the delivery URL, and Convex Auth's endpoints,
 * `/.well-known/jwks.json` among them, are expected at the origin. The
 * package's changelog names this exact case and points at this function.
 *
 * It is safe next to them. The catch-all is GET only, so the webhook's POST
 * cannot collide, and exact app routes take precedence over a prefix route.
 */
registerStaticRoutes(http, components.staticHosting);

export default http;
