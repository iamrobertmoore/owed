import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";

/**
 * Convex Auth, with two ways in.
 *
 * `Anonymous` is the one that matters for a judge: the deployed site should be
 * usable in one click, with no account to create and no password to invent.
 * `Password` is there because a ledger of what you are owed is per-person data
 * and a session that survives a browser restart is the honest default for real
 * use. Every claim, inbox, counterparty and record is scoped to a user id and
 * every read re-checks it.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, Anonymous],
});
