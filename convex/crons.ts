import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * The agent's own schedule.
 *
 * Every half hour it looks for claims whose next step has come due. This is
 * the difference between a tool you have to remember to open and one that
 * chases on the deadline the company itself published.
 */
const crons = cronJobs();

crons.interval(
  "chase sweep",
  { minutes: 30 },
  internal.sweep.run,
  { limit: 25 },
);

export default crons;
