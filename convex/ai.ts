// Deliberately not "use node": the default Convex runtime has fetch, so these
// actions avoid the Node runtime entirely and stay cheap to invoke.

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, MODEL } from "./pricing";

/**
 * Every model call in Owed goes through here.
 *
 * Two reasons this exists rather than calling OpenAI inline wherever a model
 * is needed:
 *
 * 1. The event provides no OpenAI credits, so spend is real money. Every call
 *    is cached by a content hash of its exact inputs, and every miss is logged
 *    with its token counts. The cost of this product is a number we can read
 *    out of a table, not a hope.
 * 2. Nothing here runs on a page load. A render never triggers a model call,
 *    so opening the app costs nothing.
 *
 * The model ids and the rates live in `pricing.ts`, because `claims.spend`
 * reports against the same numbers this module spends at.
 */

/**
 * A content hash for cache keys. Two independent FNV-1a passes with different
 * offsets, so the key is wide enough that an accidental collision between two
 * different prompts is not a realistic concern. This is a cache key, not a
 * security boundary.
 */
export function contentKey(...parts: string[]): string {
  const input = parts.join("\u0000");
  const fnv = (seed: bigint) => {
    let h = seed;
    for (let i = 0; i < input.length; i++) {
      h ^= BigInt(input.charCodeAt(i));
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, "0");
  };
  return fnv(0xcbf29ce484222325n) + fnv(0x9e3779b97f4a7c15n);
}

async function openai(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: any } | { ok: false; status: number; message: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok: false, status: 0, message: "OPENAI_API_KEY is not set on this deployment" };
  }
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, message: text.slice(0, 400) };
  }
  return { ok: true, data: await res.json() };
}

/**
 * A chat completion, cached. `operation` names what this call is for, so the
 * log reads as a list of jobs rather than a list of prompts.
 */
export const complete = internalAction({
  args: {
    operation: v.string(),
    system: v.string(),
    user: v.string(),
    /** Ask for a JSON object back. The caller still validates the shape. */
    json: v.optional(v.boolean()),
    maxTokens: v.optional(v.number()),
    claimId: v.optional(v.id("claims")),
  },
  handler: async (ctx, args): Promise<string> => {
    const key = contentKey("complete", MODEL, args.operation, args.system, args.user);

    const cached = await ctx.runQuery(internal.aiCache.get, { key });
    if (cached) return cached.response;

    const result = await openai("chat/completions", {
      model: MODEL,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      max_tokens: args.maxTokens ?? 900,
      temperature: 0.2,
      ...(args.json ? { response_format: { type: "json_object" } } : {}),
    });

    if (!result.ok) {
      // A failed call is recorded as a note on the claim so it is visible in
      // the ledger rather than swallowed.
      if (args.claimId) {
        await ctx.runMutation(internal.claims.note, {
          claimId: args.claimId,
          detail: `Model call "${args.operation}" failed (${result.status}): ${result.message}`,
        });
      }
      throw new Error(`OpenAI ${args.operation} failed: ${result.status} ${result.message}`);
    }

    const text: string = result.data.choices?.[0]?.message?.content ?? "";
    const inputTokens: number = result.data.usage?.prompt_tokens ?? 0;
    const outputTokens: number = result.data.usage?.completion_tokens ?? 0;

    await ctx.runMutation(internal.aiCache.put, {
      key,
      operation: args.operation,
      model: MODEL,
      response: text,
      inputTokens,
      outputTokens,
    });

    if (args.claimId) {
      await ctx.runMutation(internal.claims.logModelUse, {
        claimId: args.claimId,
        operation: args.operation,
        model: MODEL,
        inputTokens,
        outputTokens,
      });
    }

    return text;
  },
});

/** An embedding for retrieval over extracted provisions. */
export const embed = internalAction({
  args: { text: v.string() },
  handler: async (ctx, args): Promise<number[]> => {
    const key = contentKey("embed", EMBEDDING_MODEL, args.text);
    const cached = await ctx.runQuery(internal.aiCache.get, { key });
    if (cached) return JSON.parse(cached.response) as number[];

    const result = await openai("embeddings", {
      model: EMBEDDING_MODEL,
      input: args.text,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    if (!result.ok) {
      throw new Error(`OpenAI embed failed: ${result.status} ${result.message}`);
    }

    const vector: number[] = result.data.data[0].embedding;
    await ctx.runMutation(internal.aiCache.put, {
      key,
      operation: "embed",
      model: EMBEDDING_MODEL,
      response: JSON.stringify(vector),
      inputTokens: result.data.usage?.prompt_tokens ?? 0,
      outputTokens: 0,
    });
    return vector;
  },
});
