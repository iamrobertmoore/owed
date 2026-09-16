import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
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

export default http;
