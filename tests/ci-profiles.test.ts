import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (name: string) =>
  Bun.YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
const ci = read("ci");
const release = read("release");
const nightly = read("nightly-release");

function enabled(
  condition: string | undefined,
  event: string,
  branch: string,
  base = "",
  inputs = {},
) {
  if (!condition) return true;
  const expression = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  return Boolean(
    new Function("github", "inputs", `return (${expression})`)(
      { event_name: event, base_ref: base, ref: `refs/heads/${branch}` },
      inputs,
    ),
  );
}

test("agent pushes and development PRs run quick checks while stable and manual runs stay full", () => {
  for (const [event, branch, base, inputs, full] of [
    ["push", "development", "", {}, false],
    ["pull_request", "feature", "development", {}, false],
    ["pull_request", "canary", "main", {}, true],
    ["push", "canary", "", { full: false }, false],
    ["push", "main", "", { full: true }, true],
    ["workflow_dispatch", "development", "", {}, true],
  ] as const) {
    for (const job of ["browser-smoke", "rust-test", "rust-integration"]) {
      expect(enabled(ci.jobs[job].if, event, branch, base, inputs)).toBe(full);
    }
    const quick = ci.jobs.rust.steps.find(
      (step: { run?: string }) => step.run === "cargo check --locked",
    );
    expect(enabled(quick.if, event, branch, base, inputs)).toBe(!full);
  }
  expect(ci.concurrency["cancel-in-progress"]).toBe(true);
  expect(release.concurrency["cancel-in-progress"]).toBe(false);
  expect(release.jobs.checks.with.full).toContain("refs/heads/main");
  expect(release.jobs.performance).toBeUndefined();
  expect(release.jobs.draft.needs).not.toContain("performance");
});

test("unapproved nights never start builds or tests and all jobs use the event SHA", () => {
  expect(ci.on.schedule).toBeUndefined();
  expect(nightly.jobs.promote.if).toContain("vars.NIGHTLY_RELEASE_SHA != ''");
  for (const workflow of [ci]) {
    for (const job of Object.values(workflow.jobs) as {
      steps: { uses?: string; with?: { ref: string } }[];
    }[]) {
      const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
      expect(checkout?.with?.ref).toContain("github.sha");
    }
  }
});

test("integration installs Bun and frozen dependencies before using CLI tests", () => {
  const steps = ci.jobs["rust-integration"].steps;
  const bun = steps.findIndex((step: { uses?: string }) =>
    step.uses?.startsWith("oven-sh/setup-bun@"),
  );
  const install = steps.findIndex(
    (step: { run?: string }) => step.run === "bun install --frozen-lockfile",
  );
  const integration = steps.findIndex((step: { run?: string }) =>
    step.run?.includes("test-postgres-ssh.sh"),
  );
  expect(bun).toBeGreaterThan(0);
  expect(install).toBeGreaterThan(bun);
  expect(integration).toBeGreaterThan(install);
});

test("Canary uses a separate faster compiler profile and publication still requires native verification", () => {
  const build = release.jobs.build;
  const compile = build.steps.find(
    (step: { name?: string }) => step.name === "Compile without signing credentials",
  );
  expect(compile.env.CARGO_PROFILE_RELEASE_LTO).toContain("'false' || 'thin'");
  expect(compile.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS).toContain("'16' || '1'");
  expect(
    build.steps.find((step: { uses?: string }) => step.uses === "./.github/actions/setup-rust").with
      .cache,
  ).toContain("release-canary");
  expect(
    build.steps.find((step: { uses?: string }) => step.uses === "./.github/actions/setup-rust").with
      .cache,
  ).toContain("release-stable");
  expect(
    release.jobs.package.steps.some(
      (step: { name?: string }) => step.name === "Native installer and upgrade smoke",
    ),
  ).toBe(true);
});

test("nightly promotion defaults to dry run and uses a token that triggers the stable push workflow", () => {
  expect(nightly.on.workflow_dispatch.inputs.dry_run.default).toBe(true);
  expect(nightly.on.schedule[0].cron).toBe("17 1 * * *");
  expect(nightly.permissions.contents).toBe("read");
  const promote = nightly.jobs.promote.steps.at(-1);
  expect(promote.env.GH_TOKEN).toContain("secrets.RELEASE_PR_TOKEN");
  expect(promote.env.NIGHTLY_RELEASE_SHA).toContain("vars.NIGHTLY_RELEASE_SHA");
  expect(promote.env.NIGHTLY_RELEASE_DRY_RUN).toContain("inputs.dry_run");
});
