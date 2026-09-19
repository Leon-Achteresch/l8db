import { resolveColumnPrefs } from "./columns";
import type { TableColumnPref, TableLayoutProfile } from "./types";

export function normalizeLayoutProfileName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function createLayoutProfile(
  id: string,
  name: string,
  pref: TableColumnPref,
): TableLayoutProfile {
  return {
    id,
    name: normalizeLayoutProfileName(name),
    order: [...pref.order],
    hidden: [...pref.hidden],
    pinned: [...(pref.pinned ?? [])],
  };
}

export function upsertLayoutProfile(
  profiles: TableLayoutProfile[],
  profile: TableLayoutProfile,
): TableLayoutProfile[] {
  if (profile.name === "") return profiles;
  const key = profile.name.toLowerCase();
  const existing = profiles.findIndex(
    (entry) => entry.id === profile.id || entry.name.toLowerCase() === key,
  );
  if (existing === -1) return [...profiles, profile];
  const next = [...profiles];
  next[existing] = { ...profile, id: next[existing].id };
  return next;
}

export function renameLayoutProfile(
  profiles: TableLayoutProfile[],
  id: string,
  name: string,
): TableLayoutProfile[] {
  const nextName = normalizeLayoutProfileName(name);
  if (nextName === "") return profiles;
  const taken = profiles.some(
    (entry) => entry.id !== id && entry.name.toLowerCase() === nextName.toLowerCase(),
  );
  if (taken) return profiles;
  return profiles.map((entry) => (entry.id === id ? { ...entry, name: nextName } : entry));
}

export function removeLayoutProfile(
  profiles: TableLayoutProfile[],
  id: string,
): TableLayoutProfile[] {
  return profiles.filter((entry) => entry.id !== id);
}

export function applyLayoutProfile(
  columns: string[],
  profile: TableLayoutProfile,
): TableColumnPref {
  const resolved = resolveColumnPrefs(columns, {
    order: profile.order,
    hidden: profile.hidden,
    pinned: profile.pinned,
  });
  return { order: resolved.order, hidden: resolved.hidden, pinned: resolved.pinned };
}
