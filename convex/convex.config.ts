import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config.js";
import agentmail from "@agentmail/convex/convex.config.js";

const app = defineApp();

// Serves the built front end at <deployment>.convex.site.
app.use(staticHosting);

// Reads the counterparty's own published terms. This is what turns "this is
// unfair" into "clause 9.2 of your own returns policy says otherwise".
//
// The webhook secret is optional and is only used by crawl mode, which this
// app does not use: `map` plus `scrape` is enough to read a terms page and
// costs a fraction of a crawl. It is passed through so the route works if it
// is ever switched on.
app.use(firecrawl, {
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY ?? "",
    ...(process.env.FIRECRAWL_WEBHOOK_SECRET
      ? { FIRECRAWL_WEBHOOK_SECRET: process.env.FIRECRAWL_WEBHOOK_SECRET }
      : {}),
  },
});

// Gives the agent its own address. The centre of the product, not a
// notification channel: claims are sent from here and replies land here.
app.use(agentmail);

export default app;
