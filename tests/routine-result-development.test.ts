import { expect, test } from "bun:test";
import { routineResultDevelopmentSelected } from "../src/lib/development-entry";

test("routine fixture is explicitly selected in development and removed from release startup", async () => {
  expect(routineResultDevelopmentSelected(true, "?routine-result-development=1")).toBe(true);
  expect(routineResultDevelopmentSelected(false, "?routine-result-development=1")).toBe(false);
  expect(routineResultDevelopmentSelected(true, "")).toBe(false);
  expect(routineResultDevelopmentSelected(true, "?routine-result-development=1&redirect=x")).toBe(
    false,
  );
  const result = await Bun.build({
    entrypoints: ["src/main.tsx"],
    external: ["*"],
    target: "browser",
    define: { "import.meta.env.DEV": "false" },
    minify: { syntax: true },
  });
  const code = await result.outputs[0].text();
  expect(code).not.toContain("routine-result-bootstrap");
  expect(code).toContain('"./bootstrap"');
});
