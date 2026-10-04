import type { Environment, Task, Variable } from "@/lib/db/automation";

export function variableSecretAccount(
  taskId: string,
  variable: Variable,
  environment?: Environment,
): string {
  const key = variable.id || variable.name;
  if (!environment) return `automation:var:${taskId}:${key}`;
  return `automation:var:${taskId}:${environment.id || environment.name}:${key}`;
}

export function taskSecretAccounts(task: Task): string[] {
  return task.variables
    .filter((variable) => variable.kind === "secret")
    .flatMap((variable) => [
      variableSecretAccount(task.id, variable),
      ...task.environments.map((env) => variableSecretAccount(task.id, variable, env)),
    ]);
}

export function staleSecretAccounts(before: Task, after: Task | null): string[] {
  const kept = new Set(after ? taskSecretAccounts(after) : []);
  return taskSecretAccounts(before).filter((account) => !kept.has(account));
}

export function pinSecretId<T extends { id?: string; name: string }>(entry: T): T {
  return entry.id ? entry : { ...entry, id: entry.name };
}
