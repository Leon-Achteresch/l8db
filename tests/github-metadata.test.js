import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ensureLabels,
  issueLabels,
  labelChanges,
  labels,
  pullRequestLabels,
  run,
} from "../.github/scripts/metadata.mjs";

const repo = { owner: "Leon-Achteresch", repo: "l8db" };
const pr = (overrides = {}) => ({
  number: 42,
  title: "fix(query): preserve selection",
  state: "open",
  draft: false,
  changed_files: 1,
  head: { ref: "fix-editor", repo: { full_name: "contributor/l8db" } },
  ...overrides,
});
const file = (filename, additions = 5, deletions = 2, extra = {}) => ({
  filename,
  additions,
  deletions,
  ...extra,
});

function client({
  item = pr(),
  files = [file("src/features/query/query-view.tsx")],
  current = [],
} = {}) {
  const github = {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: mock(async () => ({ data: [] })),
      },
      issues: {
        listLabelsForRepo: mock(async () => ({ data: labels })),
        createLabel: mock(async () => ({})),
        listLabelsOnIssue: mock(async () => ({ data: current.map((name) => ({ name })) })),
        addLabels: mock(async () => ({})),
        removeLabel: mock(async () => ({})),
        get: mock(async () => ({ data: item })),
        listForRepo: mock(async () => ({ data: [item] })),
      },
      pulls: {
        get: mock(async () => ({ data: item })),
        listFiles: mock(async () => ({ data: files })),
        list: mock(async () => ({ data: [item] })),
      },
    },
    paginate: mock(async (method, args) => (await method(args)).data),
  };
  return { github, core: { warning: mock() } };
}

const context = (eventName, payload) => ({ eventName, repo, payload });
const workflowContext = (overrides = {}) =>
  context("workflow_run", {
    workflow_run: {
      event: "pull_request",
      path: ".github/workflows/pull-request-metadata.yml",
      head_branch: "fix-editor",
      head_sha: "a".repeat(40),
      head_repository: { full_name: "contributor/l8db", owner: { login: "contributor" } },
      pull_requests: [{ number: 42 }],
      ...overrides,
    },
  });

describe("GitHub metadata classification", () => {
  test("labels title, both sides of a rename, languages, areas, and draft state", () => {
    const result = pullRequestLabels(pr({ title: "feat(storage)!: add search", draft: true }), [
      file("src/features/storage/search.tsx", 10, 5, {
        previous_filename: "src/features/query/search.tsx",
      }),
      file("src-tauri/src/db/s3/select.rs"),
      file(".github/workflows/ci.yml"),
    ]);
    expect(result).toEqual(
      new Set([
        "enhancement",
        "breaking-change",
        "area:frontend",
        "area:storage",
        "area:query",
        "javascript",
        "area:backend",
        "area:providers",
        "rust",
        "area:ci",
        "github_actions",
        "size:S",
        "status:draft",
      ]),
    );
    for (const name of result) expect(labels.some((label) => label.name === name)).toBe(true);
  });

  test.each([
    [0, "XS"],
    [9, "XS"],
    [10, "S"],
    [99, "S"],
    [100, "M"],
    [499, "M"],
    [500, "L"],
    [999, "L"],
    [1000, "XL"],
  ])("classifies %i changed lines as %s without counting generated files", (changes, size) => {
    const result = pullRequestLabels(pr(), [
      file("src/main.tsx", changes, 0),
      file("bun.lock", 5000),
      file("src-tauri/Cargo.lock", 5000),
      file("src/routeTree.gen.ts", 5000),
    ]);
    expect([...result].filter((name) => name.startsWith("size:"))).toEqual([`size:${size}`]);
  });

  test("reads exact form fields with CRLF and rejects arbitrary text and prototype keys", () => {
    expect(
      issueLabels({
        title: "[Bug]: crash",
        body: "### Area\r\n\r\nConnections\r\n\r\n### OS\r\n\r\nWindows\r\n\r\n### Logs\r\n\r\nLinux",
      }),
    ).toEqual(new Set(["bug", "area:connections", "os:windows"]));
    expect(
      issueLabels({
        title: "constructor: test",
        body: "### Area\n\n__proto__\n\n### OS\n\nconstructor",
      }),
    ).toEqual(new Set());
    expect(issueLabels({ title: "Question", body: "Query editor on macOS" })).toEqual(new Set());
    expect(issueLabels({ title: "[Feature]: idea", body: "### Area\n\nOther" })).toEqual(
      new Set(["enhancement"]),
    );
  });

  test("reconciles managed labels and preserves manual labels", () => {
    expect(
      labelChanges(
        ["size:XL", "area:backend", "help wanted", "bug"].map((name) => ({ name })),
        new Set(["size:S", "area:frontend", "enhancement"]),
        (name) => name.startsWith("size:") || name.startsWith("area:"),
      ),
    ).toEqual({
      add: ["size:S", "area:frontend", "enhancement"],
      remove: ["size:XL", "area:backend"],
    });
  });

  test("recognizes dependency changes and Dependabot without inferring a type from prose", () => {
    const result = pullRequestLabels(
      pr({ title: "Update libraries", user: { login: "dependabot[bot]" } }),
      [file("package.json")],
    );
    expect(result.has("dependencies")).toBe(true);
    expect(result.has("bug")).toBe(false);
  });
});

describe("GitHub metadata API orchestration", () => {
  test("creates only missing repository labels and tolerates concurrent creation", async () => {
    const api = client();
    api.github.rest.issues.listLabelsForRepo.mockImplementation(async () => ({
      data: labels.slice(1),
    }));
    api.github.rest.issues.createLabel.mockImplementation(async () => {
      throw { status: 422, response: { data: { errors: [{ code: "already_exists" }] } } };
    });
    await ensureLabels(api.github, repo);
    expect(api.github.rest.issues.createLabel).toHaveBeenCalledWith({ ...repo, ...labels[0] });
    expect(api.github.rest.issues.createLabel).toHaveBeenCalledTimes(1);
    api.github.rest.issues.createLabel.mockImplementation(async () => {
      throw { status: 403 };
    });
    await expect(ensureLabels(api.github, repo)).rejects.toMatchObject({ status: 403 });
  });

  test.each(["opened", "reopened", "edited", "closed"])(
    "handles issue %s without restoring cleared triage on edits",
    async (action) => {
      const item = {
        number: 7,
        title: "[Bug]: crash",
        body: "### OS\n\nmacOS",
        state: action === "closed" ? "closed" : "open",
      };
      const api = client({ item, current: action === "closed" ? ["status:needs-triage"] : [] });
      await run({ ...api, context: context("issues", { action, issue: { number: 7 } }) });
      const added = api.github.rest.issues.addLabels.mock.calls[0][0].labels;
      expect(added.includes("status:needs-triage")).toBe(["opened", "reopened"].includes(action));
      expect(added).toContain("os:macos");
      if (action === "closed")
        expect(api.github.rest.issues.removeLabel).toHaveBeenCalledWith({
          ...repo,
          issue_number: 7,
          name: "status:needs-triage",
        });
    },
  );

  test("replaces draft and size labels using fresh PR data, preserving custom labels", async () => {
    const api = client({ current: ["status:draft", "size:XL", "help wanted"] });
    await run({ ...api, context: workflowContext() });
    expect(api.github.rest.issues.addLabels.mock.calls[0][0].labels).toContain(
      "status:ready-for-review",
    );
    expect(api.github.rest.issues.removeLabel.mock.calls.map(([args]) => args.name)).toEqual([
      "status:draft",
      "size:XL",
    ]);
    expect(api.github.rest.pulls.list).not.toHaveBeenCalled();
  });

  test("resolves empty fork event PR lists, including closed PRs", async () => {
    const api = client({ item: pr({ state: "closed" }), current: ["status:ready-for-review"] });
    await run({ ...api, context: workflowContext({ pull_requests: [] }) });
    expect(api.github.rest.pulls.list).toHaveBeenCalledWith({
      ...repo,
      state: "all",
      head: "contributor:fix-editor",
      per_page: 100,
    });
    expect(api.github.rest.issues.removeLabel).toHaveBeenCalledWith({
      ...repo,
      issue_number: 42,
      name: "status:ready-for-review",
    });
  });

  test("ignores unrelated workflows, events, and repositories", async () => {
    for (const overrides of [{ event: "push" }, { path: ".github/workflows/ci.yml" }]) {
      const api = client();
      await run({ ...api, context: workflowContext(overrides) });
      expect(api.github.rest.pulls.get).not.toHaveBeenCalled();
      expect(api.github.rest.issues.addLabels).not.toHaveBeenCalled();
    }
    const api = client({
      item: pr({ head: { ref: "fix-editor", repo: { full_name: "another/l8db" } } }),
    });
    await run({ ...api, context: workflowContext({ pull_requests: [] }) });
    expect(api.github.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  test("clears status on PRs whose fork was deleted or whose closing run uses the base branch", async () => {
    const api = client({
      item: pr({ state: "closed", head: { ref: "fix-editor", repo: null } }),
      current: ["status:draft"],
    });
    await run({ ...api, context: workflowContext({ head_branch: "main" }) });
    expect(api.github.rest.issues.removeLabel).toHaveBeenCalledWith({
      ...repo,
      issue_number: 42,
      name: "status:draft",
    });
  });

  test("resolves merged PRs by commit when the closing event has no PR list", async () => {
    const api = client({ item: pr({ state: "closed" }), current: ["status:ready-for-review"] });
    api.github.rest.repos.listPullRequestsAssociatedWithCommit.mockImplementation(async () => ({
      data: [{ number: 42 }],
    }));
    await run({ ...api, context: workflowContext({ pull_requests: [], head_branch: "main" }) });
    expect(api.github.rest.pulls.list).not.toHaveBeenCalled();
    expect(api.github.rest.issues.removeLabel).toHaveBeenCalledWith({
      ...repo,
      issue_number: 42,
      name: "status:ready-for-review",
    });
  });

  test("uses all returned file pages and skips truncated lists", async () => {
    const files = Array.from({ length: 101 }, (_, i) =>
      file(i === 100 ? "src-tauri/src/db/postgres.rs" : `docs/${i}.md`),
    );
    const api = client({ files, item: pr({ changed_files: 101 }) });
    await run({ ...api, context: workflowContext() });
    expect(api.github.rest.issues.addLabels.mock.calls[0][0].labels).toContain("area:backend");
    expect(api.github.paginate).toHaveBeenCalledWith(api.github.rest.pulls.listFiles, {
      ...repo,
      pull_number: 42,
      per_page: 100,
    });
    api.github.rest.pulls.get.mockImplementation(async () => ({
      data: pr({ changed_files: 102 }),
    }));
    api.github.rest.issues.addLabels.mockClear();
    await run({ ...api, context: workflowContext() });
    expect(api.github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(api.core.warning).toHaveBeenCalledTimes(1);
  });

  test("manual runs only backfill when requested and do not restore triage", async () => {
    const api = client({
      item: {
        number: 7,
        title: "[Feature]: request",
        state: "open",
        body: "### Area\n\nExtensions",
      },
    });
    await run({ ...api, context: context("workflow_dispatch", { inputs: { backfill: false } }) });
    expect(api.github.rest.issues.listForRepo).not.toHaveBeenCalled();
    await run({ ...api, context: context("workflow_dispatch", { inputs: { backfill: "true" } }) });
    expect(api.github.rest.issues.addLabels.mock.calls[0][0].labels).toEqual([
      "enhancement",
      "area:extensions",
    ]);
  });
});

describe("GitHub automation configuration", () => {
  const yaml = (path) =>
    Bun.YAML.parse(readFileSync(new URL(`../.github/${path}`, import.meta.url), "utf8"));

  test("uses a read-only PR signal and a trusted pinned checkout for writes", () => {
    const signal = yaml("workflows/pull-request-metadata.yml");
    expect(signal.permissions).toEqual({});
    expect(signal.jobs.notify.steps).toEqual([{ run: "true" }]);
    const workflow = yaml("workflows/metadata.yml");
    expect(workflow.on.pull_request_target).toBeUndefined();
    expect(workflow.permissions).toEqual({
      contents: "read",
      issues: "write",
      "pull-requests": "write",
    });
    expect(workflow.jobs.labels.steps[0].with.ref).toMatch(/^\$\{\{ github\.sha \}\}$/);
    expect(workflow.jobs.labels.steps[0].with["persist-credentials"]).toBe(false);
    for (const step of workflow.jobs.labels.steps) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
  });

  test("all template and Dependabot labels exist in the catalog and form options classify", () => {
    expect(new Set(labels.map((label) => label.name)).size).toBe(labels.length);
    for (const label of labels) expect(label.color).toMatch(/^[a-f0-9]{6}$/);
    const names = new Set(labels.map((label) => label.name));
    for (const path of ["bug_report.yml", "feature_request.yml"]) {
      const form = yaml(`ISSUE_TEMPLATE/${path}`);
      for (const name of form.labels) expect(names.has(name)).toBe(true);
      const options = form.body.find((field) => field.id === "area").attributes.options;
      for (const option of options.filter((option) => option !== "Other")) {
        expect(issueLabels({ body: `### Area\n\n${option}` }).size).toBe(1);
      }
    }
    for (const update of yaml("dependabot.yml").updates) {
      for (const name of update.labels) expect(names.has(name)).toBe(true);
    }
  });
});
