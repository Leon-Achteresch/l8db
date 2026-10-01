import { readFileSync } from "node:fs";

export const labels = JSON.parse(readFileSync(new URL("../labels.json", import.meta.url), "utf8"));

const areas = {
  "Table browser": "area:tables",
  "Query editor": "area:query",
  Connections: "area:connections",
  "Backend / providers": "area:providers",
  "Object storage": "area:storage",
  Extensions: "area:extensions",
  "Updater / releases": "area:releases",
  "UI / settings": "area:ui",
  Documentation: "area:docs",
  "CI / tooling": "area:ci",
};

const fileRules = [
  ["area:frontend", /^(src\/|package\.json$|bun\.lock$|index\.html$|vite\.config\.|tsconfig)/],
  ["area:backend", /^src-tauri\//],
  ["area:tables", /^src\/features\/(table|tables|table-copy|filters)\//],
  [
    "area:query",
    /^src\/(features\/(query|query-builder|explain|notebook)\/|lib\/(queries\/|sql-|query-|notebook\/))/,
  ],
  [
    "area:connections",
    /^(src\/(features\/connections\/|lib\/(connections\/|connection-|ssh\/|secrets\.))|src-tauri\/src\/(db\/ssh\/|secrets\.rs$))/,
  ],
  [
    "area:providers",
    /^(src-tauri\/src\/db\/|src\/lib\/(db\/|providers\.ts$|drivers\.ts$)|src\/features\/drivers\/)/,
  ],
  [
    "area:storage",
    /^(src-tauri\/src\/db\/s3\/|src\/(features\/storage\/|lib\/(storage\/|db\/storage\.)))/,
  ],
  [
    "area:extensions",
    /^(extention\/|examples\/.*extension\/|packages\/extension-|src\/(features\/(extensions|community-extensions)\/|lib\/extensions\/)|src-tauri\/src\/extensions)/,
  ],
  [
    "area:releases",
    /^(packaging\/|\.github\/(RELEASING\.md$|workflows\/release\.yml$|scripts\/(compute-release-version|set-version|verify-release|generate-changelog)\.)|src\/(features\/updates\/|lib\/(auto-updater|updater)\.))/,
  ],
  [
    "area:ui",
    /^src\/(components\/|routes\/|styles\/|features\/(shell|sidebar|settings|onboarding|home)\/|.*\.css$)/,
  ],
  ["area:docs", /(^docs\/|\.md$)/],
  ["area:ci", /^(\.github\/|scripts\/|biome\.json$)/],
  ["area:tests", /(^tests\/|(^|\/)[^/]*(_tests|\.test|\.spec)\.[^/]+$)/],
  ["dependencies", /(^|\/)(package\.json|bun\.lock|Cargo\.toml|Cargo\.lock)$/],
  ["github_actions", /^\.github\/workflows\//],
  ["rust", /^src-tauri\/.*\.rs$/],
  ["javascript", /\.(js|jsx|mjs|cjs|ts|tsx)$/],
];

const types = {
  fix: "bug",
  feat: "enhancement",
  docs: "documentation",
  perf: "performance",
  refactor: "refactor",
  test: "testing",
  build: "maintenance",
  ci: "maintenance",
  chore: "maintenance",
  style: "maintenance",
  revert: "maintenance",
};

function titleLabels(title = "") {
  const match = title.match(/^(\w+)(?:\([^\r\n)]*\))?(!)?:\s+\S/i);
  const result = new Set();
  if (match && Object.hasOwn(types, match[1].toLowerCase()))
    result.add(types[match[1].toLowerCase()]);
  if (match?.[2]) result.add("breaking-change");
  if (/^\[bug\]:?\s/i.test(title)) result.add("bug");
  if (/^\[feature\]:?\s/i.test(title)) result.add("enhancement");
  return result;
}

export function formField(body, heading) {
  const lines = (body ?? "").split(/\r?\n/);
  const start = lines.indexOf(`### ${heading}`);
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^#{1,6} /.test(line));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

export function issueLabels(issue) {
  const result = titleLabels(issue.title);
  const area = formField(issue.body, "Area");
  if (Object.hasOwn(areas, area)) result.add(areas[area]);
  const platforms = { macOS: "os:macos", Windows: "os:windows", Linux: "os:linux" };
  const os = formField(issue.body, "OS");
  if (Object.hasOwn(platforms, os)) result.add(platforms[os]);
  return result;
}

export function pullRequestLabels(pr, files) {
  const result = titleLabels(pr.title);
  if (pr.user?.login === "dependabot[bot]") result.add("dependencies");
  for (const file of files) {
    for (const [label, pattern] of fileRules) {
      if ([file.filename, file.previous_filename].some((path) => path && pattern.test(path))) {
        result.add(label);
      }
    }
  }
  const changes = files
    .filter((file) => !/(^|\/)(bun\.lock|Cargo\.lock|routeTree\.gen\.ts)$/.test(file.filename))
    .reduce((total, file) => total + file.additions + file.deletions, 0);
  const size =
    changes < 10 ? "XS" : changes < 100 ? "S" : changes < 500 ? "M" : changes < 1000 ? "L" : "XL";
  result.add(`size:${size}`);
  if (pr.state === "open") result.add(pr.draft ? "status:draft" : "status:ready-for-review");
  return result;
}

export function labelChanges(current, desired, managed) {
  const existing = new Set(current.map((label) => label.name));
  return {
    add: [...desired].filter((label) => !existing.has(label)),
    remove: [...existing].filter((label) => managed(label) && !desired.has(label)),
  };
}

export async function ensureLabels(github, repo) {
  const existing = await github.paginate(github.rest.issues.listLabelsForRepo, {
    ...repo,
    per_page: 100,
  });
  const names = new Set(existing.map((label) => label.name));
  for (const label of labels) {
    if (names.has(label.name)) continue;
    try {
      await github.rest.issues.createLabel({ ...repo, ...label });
    } catch (error) {
      if (
        error.status !== 422 ||
        !error.response?.data?.errors?.some((entry) => entry.code === "already_exists")
      ) {
        throw error;
      }
    }
  }
}

async function applyLabels(github, repo, issue, desired, managed) {
  const current = await github.paginate(github.rest.issues.listLabelsOnIssue, {
    ...repo,
    issue_number: issue.number,
    per_page: 100,
  });
  const changes = labelChanges(current, desired, managed);
  if (changes.add.length) {
    await github.rest.issues.addLabels({
      ...repo,
      issue_number: issue.number,
      labels: changes.add,
    });
  }
  for (const name of changes.remove) {
    try {
      await github.rest.issues.removeLabel({ ...repo, issue_number: issue.number, name });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
}

async function labelIssue(github, repo, issue, triage) {
  const desired = issueLabels(issue);
  if (triage && issue.state === "open") desired.add("status:needs-triage");
  await applyLabels(
    github,
    repo,
    issue,
    desired,
    (label) =>
      label.startsWith("area:") ||
      label.startsWith("os:") ||
      (label === "status:needs-triage" && issue.state === "closed"),
  );
}

async function labelPullRequest(github, repo, number, core) {
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...repo,
    pull_number: number,
    per_page: 100,
  });
  if (files.length < pr.changed_files) {
    core.warning(`Skipping labels for PR #${number}: GitHub returned an incomplete file list.`);
    return;
  }
  await applyLabels(
    github,
    repo,
    pr,
    pullRequestLabels(pr, files),
    (label) =>
      label.startsWith("area:") ||
      label.startsWith("size:") ||
      label === "status:draft" ||
      label === "status:ready-for-review",
  );
}

export async function run({ github, context, core }) {
  const repo = context.repo;
  await ensureLabels(github, repo);
  if (context.eventName === "issues") {
    const { data: issue } = await github.rest.issues.get({
      ...repo,
      issue_number: context.payload.issue.number,
    });
    await labelIssue(github, repo, issue, ["opened", "reopened"].includes(context.payload.action));
  } else if (context.eventName === "workflow_run") {
    const workflow = context.payload.workflow_run;
    if (
      workflow.event !== "pull_request" ||
      workflow.path.split("@")[0] !== ".github/workflows/pull-request-metadata.yml"
    )
      return;
    let prs = workflow.pull_requests;
    let associatedWithCommit = false;
    if (!prs.length) {
      prs = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
        ...repo,
        commit_sha: workflow.head_sha,
        per_page: 100,
      });
      associatedWithCommit = prs.length > 0;
    }
    if (!prs.length) {
      prs = await github.paginate(github.rest.pulls.list, {
        ...repo,
        state: "all",
        head: `${workflow.head_repository.owner.login}:${workflow.head_branch}`,
        per_page: 100,
      });
    }
    for (const pr of prs) {
      const { data: current } = await github.rest.pulls.get({ ...repo, pull_number: pr.number });
      if (
        !workflow.pull_requests.length &&
        !associatedWithCommit &&
        ((current.head.repo &&
          current.head.repo.full_name !== workflow.head_repository.full_name) ||
          current.head.ref !== workflow.head_branch)
      )
        continue;
      await labelPullRequest(github, repo, current.number, core);
    }
  } else if (
    context.eventName === "workflow_dispatch" &&
    [true, "true"].includes(context.payload.inputs?.backfill)
  ) {
    const issues = await github.paginate(github.rest.issues.listForRepo, {
      ...repo,
      state: "open",
      per_page: 100,
    });
    for (const issue of issues) {
      if (issue.pull_request) await labelPullRequest(github, repo, issue.number, core);
      else await labelIssue(github, repo, issue, false);
    }
  }
}
