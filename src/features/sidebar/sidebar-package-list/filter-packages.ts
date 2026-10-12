import type { PackageMemberInfo } from "@/lib/db";
import { type SearchPatternCompileResult, splitSearchPatterns } from "@/lib/regex-search";

export interface PackageMatch {
  schema: string;
  name: string;
  matchingMembers?: string[];
}

export function packageMemberKey(schema: string, name: string) {
  return JSON.stringify([schema, name]);
}

export function groupPackageMembers(members: PackageMemberInfo[] | undefined) {
  const groups = new Map<string, Set<string>>();
  for (const member of members ?? []) {
    const key = packageMemberKey(member.schema, member.package);
    const names = groups.get(key) ?? new Set<string>();
    names.add(member.name);
    groups.set(key, names);
  }
  return new Map([...groups].map(([key, names]) => [key, [...names]]));
}

export function filterPackages(
  items: PackageMatch[] | undefined,
  membersByPackage: ReadonlyMap<string, string[]>,
  search: string,
  includeMembers: boolean,
  compiled: SearchPatternCompileResult | null,
): PackageMatch[] | undefined {
  if (!items) return undefined;
  const patterns = splitSearchPatterns(search);
  if (!patterns.length || (compiled && !compiled.ok)) return items;
  const lowerPatterns = patterns.map((pattern) => pattern.toLowerCase());
  const matches = compiled?.ok
    ? (value: string) => compiled.regexes.some((regex) => regex.test(value))
    : (value: string) => lowerPatterns.some((pattern) => value.toLowerCase().includes(pattern));
  const result: PackageMatch[] = [];
  for (const item of items) {
    const nameMatch = matches(item.name);
    if (!includeMembers) {
      if (nameMatch) result.push(item);
      continue;
    }
    const names = membersByPackage.get(packageMemberKey(item.schema, item.name)) ?? [];
    const matchingMembers = names.filter(matches);
    if (nameMatch || matchingMembers.length) result.push({ ...item, matchingMembers });
  }
  return result;
}

export function matchingMembersWindow(filtered: PackageMatch[]) {
  if (!filtered.some((item) => item.matchingMembers?.length)) return undefined;
  const memberCount = (index: number) => filtered[index].matchingMembers?.length ?? 0;
  return {
    estimateSize: (index: number) => (memberCount(index) ? 35 + 25 * memberCount(index) : 32),
    getItemKey: (index: number) =>
      `${packageMemberKey(filtered[index].schema, filtered[index].name)}:${memberCount(index)}`,
  };
}
