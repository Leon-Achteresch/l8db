const patterns = new Map<string, RegExp>();

export function replaceSchemeUrls(
  text: string,
  rest: string,
  replace: (url: string) => string,
): string {
  if (!text.includes("://")) return text;
  let pattern = patterns.get(rest);
  if (!pattern) {
    pattern = new RegExp(`([a-z0-9+.-]+)(:\\/\\/${rest})?`, "gi");
    patterns.set(rest, pattern);
  }
  return text.replace(pattern, (match, run: string, tail?: string) => {
    const start = tail ? run.search(/[a-z]/i) : -1;
    return start < 0 ? match : run.slice(0, start) + replace(run.slice(start) + tail);
  });
}
