import { basename } from "node:path";

export function selectTestFiles(args: string[], discovered: string[]) {
  const selected = args.filter((arg) => /\.test\.[cm]?[jt]sx?$/.test(arg));
  return {
    flags: args.filter((arg) => !selected.includes(arg)),
    files: selected.length
      ? selected
      : discovered.filter((file) => !basename(file).startsWith("perf-")).sort(),
  };
}
