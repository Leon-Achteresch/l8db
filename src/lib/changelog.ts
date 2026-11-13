export interface ChangelogGroup {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  groups: ChangelogGroup[];
}

export function parseChangelog(source: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  for (const line of source.split("\n")) {
    const release = /^## \[(.+?)\](?: - (.+))?$/.exec(line);
    if (release) {
      releases.push({ version: release[1], date: release[2]?.trim() ?? "", groups: [] });
      continue;
    }
    const current = releases.at(-1);
    if (!current) continue;
    if (line.startsWith("### ")) current.groups.push({ title: line.slice(4).trim(), items: [] });
    else if (line.startsWith("- ")) {
      if (!current.groups.length) current.groups.push({ title: "Änderungen", items: [] });
      current.groups.at(-1)?.items.push(line.slice(2).trim());
    }
  }
  return releases;
}
