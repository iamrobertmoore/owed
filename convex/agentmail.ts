/**
 * The two calls the app makes to AgentMail itself.
 *
 * The component cannot make them, and that was measured rather than assumed.
 *
 * A Convex component runs isolated from the app's environment: only the system
 * variables are visible inside one. `@agentmail/convex` reads
 * `process.env.AGENTMAIL_API_KEY` inside its own functions and declares no env
 * of its own, so there is no way to hand it the key either. Pushing
 * `app.use(agentmail, { env: { AGENTMAIL_API_KEY } })` is refused outright:
 * "Component agentmail has no env var named AGENTMAIL_API_KEY". On the judged
 * deployment every call the component made to the provider came back
 * "AGENTMAIL_API_KEY is not set on this Convex deployment", including the
 * send, so the letter could never have gone out.
 *
 * The second defect sits at the other boundary. The component's `createInbox`
 * is an `internalAction`, and Convex exposes only a component's *public*
 * functions to the parent app, so `components.agentmail.lib.createInbox` never
 * resolves from here. Both failures are invisible until something presses
 * send, which is why the guest path looked proven while the owner's address
 * had never been created on any deployment.
 *
 * So the app makes these two calls with the key it does hold, and leaves the
 * component the half it does well: verifying the webhook signature,
 * deduplicating by event id, mirroring the message and dispatching the
 * callback. Nothing about the app's own tables changes.
 */

const BASE_URL = (
  process.env.AGENTMAIL_BASE_URL ?? "https://api.agentmail.to/v0"
).replace(/\/$/, "");

export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; detail: string };

/**
 * The provider's stable code, out of the body rather than off the status.
 *
 * AgentMail's own schema says to branch on the code and not on the message
 * text, and every 403 body also carries `"code": 403`, so the status is not a
 * code: a refused credential and a spent allowance are both 403 and they want
 * opposite responses.
 */
function providerCode(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name) return parsed.name;
  } catch {
    // Not JSON. The status is all there is.
  }
  return `http_${status}`;
}

async function call<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<ProviderResult<T>> {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) {
    return {
      ok: false,
      code: "no_key",
      detail: "AGENTMAIL_API_KEY is not set on this deployment.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    return {
      ok: false,
      code: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      code: providerCode(text, response.status),
      detail: text.slice(0, 300),
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, code: "unreadable", detail: text.slice(0, 300) };
  }
}

/**
 * What the provider answers with when it has made an inbox.
 *
 * `email` is the field it actually returns, and it is the whole address. The
 * component's own types call the same value `address`, which the API does not
 * send, so both are read and the caller falls back to the local part.
 */
export type CreatedInbox = {
  email?: string;
  address?: string;
  inbox_id?: string;
  id?: string;
};

/**
 * Ask for an inbox of this owner's own.
 *
 * `client_id` makes the request idempotent, so a retry returns the same inbox
 * rather than spending a second slot of the free plan's allowance.
 */
export async function createInbox(
  local: string,
  userId: string,
): Promise<ProviderResult<CreatedInbox>> {
  return await call<CreatedInbox>("/inboxes", {
    method: "POST",
    body: {
      username: local,
      display_name: "Owed",
      client_id: `owed-${userId}`,
    },
  });
}

/** What the provider answers with when it has accepted a message. */
export type SentMessage = {
  message_id?: string;
  thread_id?: string;
};

/**
 * Put one letter on the wire from the agent's own address.
 *
 * The path takes the inbox address as readily as the inbox id, which is what
 * the app stores for a guest alias. `reply_to` is the owner's own address, so
 * the answer comes back to something the inbound router can resolve by address
 * rather than only by the claim label on the thread.
 */
export async function sendMessage(
  inboxId: string,
  letter: {
    to: string;
    subject: string;
    text: string;
    replyTo: string;
    labels: string[];
  },
): Promise<ProviderResult<SentMessage>> {
  return await call<SentMessage>(`/inboxes/${inboxId}/messages/send`, {
    method: "POST",
    body: {
      to: letter.to,
      subject: letter.subject,
      text: letter.text,
      reply_to: letter.replyTo,
      labels: letter.labels,
    },
  });
}
