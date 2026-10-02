import { readFileSync } from "node:fs";
import { newestRelease, nextVersion, releases } from "./release-utils.mjs";

const current = JSON.parse(readFileSync("package.json", "utf8")).version;
process.stdout.write(nextVersion(current, newestRelease(releases())?.tag_name.slice(1)));
