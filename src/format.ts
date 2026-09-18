/**
 * Formatting. Money and dates are the only two things a reader checks against
 * their own memory, so both are formatted the same way everywhere.
 */

export function money(amount: number | null | undefined, currency = "GBP"): string {
  // An en dash, not an em dash. The house style keeps em dashes out of anything
  // a reader sees, and a placeholder glyph is still read.
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "–";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** "15 Sep 2026" */
export function day(at: number | undefined): string {
  if (!at) return "";
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "15 Sep 2026, 14:20" */
export function moment(at: number | undefined): string {
  if (!at) return "";
  return new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * How long ago, in words. Deliberately coarse: this is read at a glance, not
 * measured, and a claim that is four days old and one that is six days old are
 * the same fact to the person waiting.
 */
export function ago(at: number | undefined): string {
  if (!at) return "";
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

/** How long until, in words. Used for the deadline the company itself set. */
export function until(at: number | undefined): string {
  if (!at) return "";
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  if (days <= 0) return "due now";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

/**
 * The sender as a person rather than a header.
 *
 * A `From` header usually arrives as `Name <address>`, and the name is the half
 * that reads as a person. The address is the fallback rather than the default,
 * which is a fact about the product and not only about formatting: a forward
 * from a personal mailbox carries its owner's name, and a list that showed the
 * address instead would be showing something the mail did not say.
 *
 * It lives here because two surfaces print a sender, the arrivals list and the
 * paper block on the claim sheet, and two copies of this rule would be two
 * answers to "who sent this" the moment one of them changed.
 */
export function senderOf(from: string): string {
  const angled = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].trim();
    if (name) return name;
    return angled[2].trim();
  }
  return from.trim();
}

const STAGE_LABEL: Record<string, string> = {
  detected: "Found",
  drafting: "Writing",
  awaiting_approval: "Needs you",
  sent: "Sent",
  negotiating: "In reply",
  escalated: "Escalated",
  settled: "Recovered",
  exhausted: "Closed",
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** Only one stage means money actually came back. */
export function isRecovered(stage: string): boolean {
  return stage === "settled";
}

/** Closed without a resolution. Neither recovered nor still owed. */
export function isClosed(stage: string): boolean {
  return stage === "exhausted";
}

const KIND_LABEL: Record<string, string> = {
  order: "Order",
  booking: "Booking",
  subscription: "Subscription",
  service: "Service",
  other: "Record",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

const EVENT_LABEL: Record<string, string> = {
  detected: "Found",
  policy_read: "Terms read",
  drafted: "Drafted",
  approved: "Approved",
  sent: "Sent",
  replied: "Reply",
  classified: "Read",
  escalated: "Escalated",
  settled: "Recovered",
  exhausted: "Closed",
  note: "Note",
};

export function eventLabel(kind: string): string {
  return EVENT_LABEL[kind] ?? kind;
}
