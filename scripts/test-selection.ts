import { basename } from "node:path";

export function selectTestFiles(args: string[], discovered: string[]) {
  const selected = args.filter((arg) => /\.test\.[cm]?[jt]sx?$/.test(arg));
  return {
    flags: args.filter((arg) => !selected.includes(arg)),
    files: selected.length
      ? selected
      : discovered
          .filter((file) => {
            const name = basename(file);
            return (
              !name.startsWith("perf-") ||
              name === "perf-test.test.ts" ||
              name === "perf-load.test.ts"
            );
          })
          .sort(),
  };
}
