import { execFileSync } from "node:child_process";
import { MEDIA_REPOSITORY, MEDIA_TAG } from "../../src/lib/feature-videos/model";

export function gh(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 2_000_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function api(path: string, method = "GET", body?: unknown): any {
  const output = execFileSync(
    "gh",
    [
      "api",
      `repos/${MEDIA_REPOSITORY}/${path}`,
      "--method",
      method,
      ...(body === undefined ? [] : ["--input", "-"]),
    ],
    {
      input: body === undefined ? undefined : JSON.stringify(body),
      encoding: "utf8",
      maxBuffer: 2_000_000,
    },
  );
  return output.trim() ? JSON.parse(output) : null;
}

export function mediaRelease(): any | null {
  try {
    return api(`releases/tags/${MEDIA_TAG}`);
  } catch (error) {
    if (String((error as { stderr?: unknown }).stderr).includes("404")) return null;
    throw error;
  }
}

export function releaseAssets(id: number): any[] {
  const pages = JSON.parse(
    gh([
      "api",
      `repos/${MEDIA_REPOSITORY}/releases/${id}/assets?per_page=100`,
      "--paginate",
      "--slurp",
    ]),
  );
  return pages.flat();
}

export function clipReleases(): any[] {
  return JSON.parse(
    gh(["api", `repos/${MEDIA_REPOSITORY}/releases?per_page=100`, "--paginate", "--slurp"]),
  )
    .flat()
    .filter((release: { tag_name: string }) => release.tag_name.startsWith("feature-video-"));
}
