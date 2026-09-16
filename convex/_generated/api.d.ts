/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as aiCache from "../aiCache.js";
import type * as auth from "../auth.js";
import type * as claims from "../claims.js";
import type * as crons from "../crons.js";
import type * as devtest from "../devtest.js";
import type * as example from "../example.js";
import type * as http from "../http.js";
import type * as inboxes from "../inboxes.js";
import type * as letters from "../letters.js";
import type * as policies from "../policies.js";
import type * as pricing from "../pricing.js";
import type * as records from "../records.js";
import type * as sweep from "../sweep.js";
import type * as triage from "../triage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  aiCache: typeof aiCache;
  auth: typeof auth;
  claims: typeof claims;
  crons: typeof crons;
  devtest: typeof devtest;
  example: typeof example;
  http: typeof http;
  inboxes: typeof inboxes;
  letters: typeof letters;
  policies: typeof policies;
  pricing: typeof pricing;
  records: typeof records;
  sweep: typeof sweep;
  triage: typeof triage;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
};
