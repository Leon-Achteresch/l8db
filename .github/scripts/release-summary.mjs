import { appendFileSync } from "node:fs";
import { gh, REPOSITORY } from "./release-utils.mjs";

const jobs = JSON.parse(
  gh(
    "api",
    "--paginate",
    "--slurp",
    `repos/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/jobs?per_page=100&filter=latest`,
  ),
).flatMap((page) => page.jobs);
const rows = jobs.map((job) => {
  const elapsed =
    job.completed_at && job.started_at
      ? Math.max(0, (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 60000).toFixed(1)
      : "—";
  return `| ${job.name} | ${job.conclusion ?? job.status} | ${elapsed} |`;
});
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  `Release jobs for ${process.env.GITHUB_SHA}\n\n| Job | Result | Minutes |\n| --- | --- | ---: |\n${rows.join("\n")}\n`,
);
