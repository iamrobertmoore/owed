/**
 * The prices this project is billed at.
 *
 * They live in one module because they are used in two: the calls that spend
 * the money (`ai.ts`) and the ledger that reports it (`claims.spend`). Two
 * copies of a price is one copy that is wrong, and this project is explicitly
 * trying to make its own cost legible rather than assumed.
 */

/** The cheap models. gpt-4o-mini is $0.15/$0.60 per million tokens. */
export const MODEL = "gpt-4o-mini";
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Embedding width. text-embedding-3-small truncated to 1024 dimensions. */
export const EMBEDDING_DIMENSIONS = 1024;

/** Published OpenAI rates, USD per token. */
const INPUT_USD_PER_TOKEN = 0.15 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 0.6 / 1_000_000;
const EMBEDDING_USD_PER_TOKEN = 0.02 / 1_000_000;

/** What a set of token counts cost, at those rates. */
export function usdFor(tokens: {
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
}): number {
  return (
    tokens.inputTokens * INPUT_USD_PER_TOKEN +
    tokens.outputTokens * OUTPUT_USD_PER_TOKEN +
    tokens.embeddingTokens * EMBEDDING_USD_PER_TOKEN
  );
}

/**
 * The scope key the deployment-wide spend totals are stored under.
 *
 * `aiCache.put` writes the totals under this key and `claims.spend` reads them
 * back under it. A literal written in two files is one edit away from a spend
 * figure that silently reads zero, so it is written here once.
 */
export const SPEND_SCOPE = "deployment";

/** As much of a logged model call as the totals need. */
export type LoggedCall = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** The three token buckets and a call count, which is what the ledger reports. */
export type SpendTotals = {
  distinctCalls: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
};

/**
 * Sum logged calls into the buckets the spend is priced from.
 *
 * **The classification lives here once and is used twice**, which is the point.
 * The batch recount that backfills the totals calls it with every row, and the
 * incremental bump in `aiCache.put` calls it with the one call it is adding.
 * Two copies of the rule would be two chances for a running total to stop
 * agreeing with the rows it counts, and nothing on a request path would notice.
 *
 * It sits in this module rather than beside its callers because it has no
 * framework import, so a harness can import it and run it directly. The rates
 * are here for the same reason.
 */
export function summarise(calls: LoggedCall[]): SpendTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let embeddingTokens = 0;
  for (const call of calls) {
    if (call.model === EMBEDDING_MODEL) embeddingTokens += call.inputTokens;
    else {
      inputTokens += call.inputTokens;
      outputTokens += call.outputTokens;
    }
  }
  return { distinctCalls: calls.length, inputTokens, outputTokens, embeddingTokens };
}
