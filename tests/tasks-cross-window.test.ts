import { expect, test } from "bun:test";
import { type AppTask, mergeTasks, TASK_OWNER } from "../src/lib/tasks";

const task = (
  id: string,
  owner: string | undefined,
  status: AppTask["status"],
  startedAt: number,
) => ({ id, title: id, owner, status, startedAt, cancellable: true }) as AppTask;

test("keeps own tasks and takes other windows' tasks without overwriting them", () => {
  const own = task("own", TASK_OWNER, "running", 3);
  const saved = [task("own", TASK_OWNER, "success", 3), task("other", "window-b", "running", 2)];
  const merged = mergeTasks(saved, [own], false, true);
  expect(merged.map((entry) => [entry.id, entry.status, entry.cancellable])).toEqual([
    ["own", "running", true],
    ["other", "running", false],
  ]);
});

test("a new window leaves running tasks of other windows running", () => {
  const merged = mergeTasks([task("other", "window-b", "running", 1)], [], true, false);
  expect(merged[0].status).toBe("running");
});

test("the main window marks tasks left over from the last app run as interrupted", () => {
  const merged = mergeTasks(
    [task("old", "window-a", "running", 1), task("legacy", undefined, "cancelling", 2)],
    [],
    true,
    true,
  );
  expect(merged.map((entry) => entry.status)).toEqual(["interrupted", "interrupted"]);
  expect(mergeTasks([task("legacy", undefined, "running", 2)], [], true, false)[0].status).toBe(
    "interrupted",
  );
});
