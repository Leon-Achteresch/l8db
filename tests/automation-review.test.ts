import { describe, expect, test } from "bun:test";
import { newStep, newTask } from "../src/lib/automation/defaults";
import {
  pinSecretId,
  staleSecretAccounts,
  taskSecretAccounts,
  variableSecretAccount,
} from "../src/lib/automation/secrets";
import { validateTask } from "../src/lib/automation/validation";
import type { Environment, Task, Variable } from "../src/lib/db/automation";

const secret = (name: string, id?: string): Variable => ({
  id,
  name,
  kind: "secret",
  defaultValue: "",
  choices: [],
  prompt: false,
  description: "",
});

const withSecrets = (variables: Variable[], environments: Environment[] = []): Task => ({
  ...newTask("t"),
  id: "task-1",
  variables,
  environments,
});

describe("secret variable accounts", () => {
  test("legacy entries use the name, stable entries the id", () => {
    const prod: Environment = { name: "prod", variables: {} };
    const test: Environment = { id: "env-1", name: "test", variables: {} };
    expect(variableSecretAccount("task-1", secret("token"))).toBe("automation:var:task-1:token");
    expect(variableSecretAccount("task-1", secret("token", "var-1"))).toBe(
      "automation:var:task-1:var-1",
    );
    expect(variableSecretAccount("task-1", secret("token", "var-1"), prod)).toBe(
      "automation:var:task-1:prod:var-1",
    );
    expect(variableSecretAccount("task-1", secret("token"), test)).toBe(
      "automation:var:task-1:env-1:token",
    );
  });

  test("renaming keeps the account for every keystroke", () => {
    const env: Environment = { name: "prod", variables: {} };
    const original = secret("token");
    const before = [
      variableSecretAccount("task-1", original),
      variableSecretAccount("task-1", original, env),
    ];
    let current = original;
    let currentEnv = env;
    for (const name of ["toke", "tok", "", "api", "api_key"]) {
      current = { ...pinSecretId(current), name };
      currentEnv = { ...pinSecretId(currentEnv), name: `${name}-env` };
      expect([
        variableSecretAccount("task-1", current),
        variableSecretAccount("task-1", current, currentEnv),
      ]).toEqual(before);
    }
  });

  test("saving drops accounts of removed secrets and environments only", () => {
    const prod: Environment = { id: "env-p", name: "prod", variables: {} };
    const test: Environment = { id: "env-t", name: "test", variables: {} };
    const keep = secret("keep", "var-k");
    const drop = secret("drop", "var-d");
    const before = withSecrets([keep, drop], [prod, test]);
    expect(taskSecretAccounts(before)).toHaveLength(6);
    const renamed = withSecrets([{ ...keep, name: "renamed" }], [{ ...prod, name: "live" }]);
    expect(staleSecretAccounts(before, renamed).sort()).toEqual(
      [
        "automation:var:task-1:var-d",
        "automation:var:task-1:env-p:var-d",
        "automation:var:task-1:env-t:var-d",
        "automation:var:task-1:env-t:var-k",
      ].sort(),
    );
    const demoted = withSecrets([{ ...keep, kind: "text" }, drop], [prod, test]);
    expect(staleSecretAccounts(before, demoted)).toEqual([
      "automation:var:task-1:var-k",
      "automation:var:task-1:env-p:var-k",
      "automation:var:task-1:env-t:var-k",
    ]);
    expect(staleSecretAccounts(before, null)).toEqual(taskSecretAccounts(before));
  });
});

describe("unknown variable check", () => {
  const warnings = (task: Task, message: string) => {
    const step = newStep("log");
    if (step.action.type === "log") step.action.message = message;
    return validateTask({ ...task, steps: [step] })
      .filter((issue) => issue.stepId === step.id && issue.message.startsWith("Unbekannte"))
      .map((issue) => issue.message);
  };

  test("full names with dots and dashes count as known", () => {
    const task = {
      ...newTask("t"),
      variables: [{ ...secret("report.dir"), kind: "text" as const, defaultValue: "/tmp" }],
    };
    expect(warnings(task, "${report.dir} ${report.dir|upper}")).toEqual([]);
  });

  test("unknown dotted names still warn", () => {
    expect(warnings(newTask("t"), "${report.dir}")).toEqual(["Unbekannte Variable „report.dir“."]);
  });
});
