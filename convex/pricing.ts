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
