import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const release = Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8"));
const followup = Bun.YAML.parse(readFileSync(".github/workflows/release-followup.yml", "utf8"));

test("compilation runs alongside CI while signing and publication require all gates", () => {
  expect(release.jobs.build.needs).toBe("prepare");
  expect(release.jobs.checks.needs).toBe("prepare");
  expect(release.jobs.build.permissions).toBeUndefined();
  for (const step of release.jobs.build.steps) {
    expect(JSON.stringify(step)).not.toContain("secrets.");
  }
  expect(release.jobs.package.needs).toEqual(expect.arrayContaining(["checks", "build", "draft"]));
  expect(release.jobs.finalize.needs).toEqual(
    expect.arrayContaining(["checks", "build", "package"]),
  );
  expect(release.permissions.contents).toBe("read");
  expect(release.jobs.finalize.permissions.contents).toBe("write");
});

test("post-publication work runs independently and can be resumed by published tag", () => {
  expect(release.jobs.changelog).toBeUndefined();
  expect(release.jobs["feature-videos"]).toBeUndefined();
  expect(followup.on.workflow_run.workflows).toEqual(["Release"]);
  expect(followup.on.workflow_dispatch.inputs.release_tag.required).toBe(true);
  expect(followup.jobs.resolve.if).toContain("head_repository.full_name == github.repository");
  expect(followup.jobs.packaging.if).toBe("needs.resolve.outputs.packaging == 'true'");
});

test("production matrices use explicit runners and immutable action references", () => {
  for (const job of [release.jobs.build, release.jobs.package]) {
    for (const target of job.strategy.matrix.include) {
      expect(target.runner).not.toContain("latest");
      expect(target.target).not.toBe("");
    }
  }
  for (const file of [
    "release.yml",
    "release-prepare.yml",
    "release-followup.yml",
    "ci.yml",
    "feature-videos.yml",
  ]) {
    const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
    for (const match of workflow.matchAll(/uses:\s*[^\s]+@([^\s]+)/g))
      expect(match[1]).toMatch(/^[a-f0-9]{40}$/);
  }
  const rust = Bun.YAML.parse(readFileSync(".github/actions/setup-rust/action.yml", "utf8"));
  expect(rust.runs.steps[0].with.toolchain).toMatch(/^\d+\.\d+\.\d+$/);
  expect(rust.runs.steps[1].with["shared-key"]).toContain("inputs.cache");
});
