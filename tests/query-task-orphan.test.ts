import { expect, mock, test } from "bun:test";

let cancelCalls = 0;

mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string) => {
    if (command === "execute_query") return new Promise(() => {});
    if (command === "cancel_execution") {
      cancelCalls++;
      return Promise.resolve(false);
    }
    return Promise.resolve(null);
  },
}));

const { FALLBACK_PROVIDERS, useProvidersStore } = await import("../src/lib/providers");
const { invoke } = await import("../src/lib/db/core");
const { cancelTask, isTaskActive, useTasksStore } = await import("../src/lib/tasks");

test("a query the backend no longer runs stops showing as running after cancel", async () => {
  useProvidersStore.setState({ providers: FALLBACK_PROVIDERS, loaded: true });
  void invoke("execute_query", {
    kind: "postgres",
    connectionString: "postgres://localhost/db",
    sql: "SELECT 1",
    options: { confirmed: true, jobId: "orphan-job" },
  });
  const findTask = () => useTasksStore.getState().tasks.find((task) => task.id === "orphan-job");
  for (let attempt = 0; attempt < 100 && !findTask(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const started = findTask();
  expect(started && isTaskActive(started)).toBe(true);

  await cancelTask("orphan-job");

  const task = useTasksStore.getState().tasks.find((entry) => entry.id === "orphan-job");
  expect(cancelCalls).toBe(5);
  expect(task?.status).toBe("error");
  expect(task?.cancellable).toBe(false);
  expect(task?.error).toContain("nicht mehr aus");
});
