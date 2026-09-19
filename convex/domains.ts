/**
 * The registrable domain of a host: the company's own site, rather than the
 * host it happens to send mail from.
 *
 * This exists because of a measured defect, not a theory. Companies send from
 * subdomains that host no terms at all, and the crawler was pointed at whatever
 * the sender's address said. Spotify's price-change notice comes from
 * `no-reply@legal.spotify.com` and Ring's from `no-reply@mail.ring.com`. Neither
 * `legal.spotify.com` nor `mail.ring.com` serves a sitemap or a policy page, so
 * the crawl mapped a host with nothing on it and reported, correctly and
 * uselessly, that it found no terms. Both were marked `skipped`.
 *
 * Measured on 18 September 2026: of eight real forwards, the four that worked
 * came from companies whose mail is sent from their own bare domain
 * (`sigmasports.com`, `virginactive.co.uk`), and the ones that failed came from
 * `mail.`, `legal.` and other sending hosts. The two best problem-bearing emails
 * on the deployment, a Spotify price rise and a Ring price rise, produced no
 * claim for this reason alone.
 *
 * Stripping to the registrable domain is the difference between reading a
 * company's published terms and reading nothing.
 *
 * **The reduction has a measured limit, found on 19 September 2026, and it is the
 * case to know about before trusting it.** It only helps when the sending host is
 * a *subdomain* of the company's site, so that dropping labels arrives at the
 * site. Sky sends from `sky@email.contact.sky`, and `contact.sky` is a domain of
 * its own rather than a subdomain of `sky.com`, so the reduction stops at
 * `contact.sky` and never reaches the site that publishes Sky's terms. The crawl
 * then reported `Looked at 26 URLs on contact.sky (sitemap 0, mapper 17), none
 * looked like terms`, against a real broadband price-rise notice that states a
 * problem on a contract with a term left to run. The record it should have found
 * a claim in stayed a record.
 *
 * No amount of label stripping fixes this one, because the company's own site is
 * not a parent of the host it sent from. A fix has to ask for the company's site
 * in its own right rather than reduce the sender's host, and until it does, a
 * `skipped` crawl on a two-label host is a reason to look at the site by hand
 * rather than a reason to believe the company publishes no terms.
 */

/**
 * Multi-part public suffixes we are realistically going to meet.
 *
 * A full public suffix list is a large generated file and a dependency. The
 * failure mode of this shorter list is mild and one-directional: an unknown
 * two-part suffix yields a domain one label too *short*, so `shop.example.co.zz`
 * reduces to `co.zz` rather than to `example.co.zz`. The crawl then starts at a
 * host that does not resolve, and the raw host that `originsFor` returns as its
 * second origin is the company's own site, so the walk still gets there at the
 * cost of one wasted map call. It cannot produce a confident wrong answer, which
 * is the property that matters.
 */
const MULTI_PART_SUFFIXES = new Set([
  // United Kingdom
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
  // Oceania
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "net.nz", "org.nz",
  // The rest of the common two-part endings
  "co.za", "co.jp", "com.br", "co.in", "com.sg", "com.hk", "com.my", "co.il",
  "com.tr", "com.mx", "co.kr", "com.tw", "com.cn", "org.cn", "co.id", "com.ph",
  "co.th", "com.ar", "com.co", "com.pe", "co.ke", "com.ng", "co.ae", "com.sa",
]);

/**
 * Reduce a host, or anything that looks like one, to its registrable domain.
 *
 * Tolerates a scheme, a path, a port, a trailing dot and a userinfo prefix,
 * because the value arrives from a language model rather than from a URL
 * parser. A single-label host and a two-label host are returned as they are,
 * which is what keeps the worked example's `haldenoptics.example` intact.
 */
export function registrableDomain(host: string): string {
  const bare = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^/@]*@/, "")
    .split("/")[0]
    .split("?")[0]
    .split(":")[0]
    .replace(/\.+$/, "");
  const parts = bare.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/** The hosts to try, best first: the company's own site, then the sender's. */
export function originsFor(domain: string): string[] {
  const registrable = registrableDomain(domain);
  const raw = String(domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  const hosts = [registrable, raw].filter(Boolean);
  return [...new Set(hosts)].map((h) => `https://${h}`);
}
