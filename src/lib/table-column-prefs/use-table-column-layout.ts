import { useCallback, useMemo, useState } from "react";
import { resolveColumnPrefs, tableColumnPrefKey } from "./columns";
import {
  applyLayoutProfile,
  createLayoutProfile,
  removeLayoutProfile,
  renameLayoutProfile,
  upsertLayoutProfile,
} from "./layout-profiles";
import type { TableColumnPref, TableLayoutProfile } from "./types";
import { useTableColumnPrefs } from "./use-table-column-prefs";

const EMPTY_PROFILES: TableLayoutProfile[] = [];

function newProfileId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTableColumnLayout(
  connectionId: string | null | undefined,
  schema: string | undefined,
  table: string | undefined,
  columns: string[],
  database?: string | null,
  layoutKey?: string | null,
) {
  const key = layoutKey
    ? layoutKey
    : connectionId && schema && table
      ? tableColumnPrefKey(connectionId, schema, table, database)
      : null;
  const legacyKey =
    !layoutKey && connectionId && schema && table && database !== undefined
      ? tableColumnPrefKey(connectionId, schema, table)
      : null;
  const legacyPref = useTableColumnPrefs((state) =>
    legacyKey ? state.prefs[legacyKey] : undefined,
  );
  const legacyProfiles = useTableColumnPrefs((state) =>
    legacyKey ? state.profiles?.[legacyKey] : undefined,
  );
  const saved = useTableColumnPrefs((state) => (key ? state.prefs[key] : undefined));
  const setPref = useTableColumnPrefs((state) => state.setPref);
  const resetPref = useTableColumnPrefs((state) => state.resetPref);
  const setProfilesFor = useTableColumnPrefs((state) => state.setProfiles);
  const storedProfiles = useTableColumnPrefs((state) => (key ? state.profiles?.[key] : undefined));
  const [ephemeral, setEphemeral] = useState<TableColumnPref | undefined>();
  const source = key ? saved : ephemeral;
  const resolved = useMemo(() => resolveColumnPrefs(columns, source), [columns, source]);

  const write = useCallback(
    (pref: TableColumnPref) => {
      if (key) {
        setPref(key, pref);
        return;
      }
      setEphemeral(pref);
    },
    [key, setPref],
  );

  const setOrder = useCallback(
    (order: string[]) => {
      write({ order, hidden: resolved.hidden, pinned: resolved.pinned });
    },
    [write, resolved.hidden, resolved.pinned],
  );

  const setHidden = useCallback(
    (hidden: string[]) => {
      write({ order: resolved.order, hidden, pinned: resolved.pinned });
    },
    [write, resolved.order, resolved.pinned],
  );

  const setPinned = useCallback(
    (pinned: string[]) => {
      write({ order: resolved.order, hidden: resolved.hidden, pinned });
    },
    [write, resolved.order, resolved.hidden],
  );

  const profiles = useMemo(() => storedProfiles ?? EMPTY_PROFILES, [storedProfiles]);

  const saveProfile = useCallback(
    (name: string) => {
      if (!key) return;
      const profile = createLayoutProfile(newProfileId(), name, resolved);
      if (profile.name === "") return;
      setProfilesFor(key, upsertLayoutProfile(profiles, profile));
    },
    [key, profiles, resolved, setProfilesFor],
  );

  const applyProfile = useCallback(
    (id: string) => {
      const profile = profiles.find((entry) => entry.id === id);
      if (!profile) return;
      write(applyLayoutProfile(columns, profile));
    },
    [profiles, columns, write],
  );

  const renameProfile = useCallback(
    (id: string, name: string) => {
      if (!key) return;
      setProfilesFor(key, renameLayoutProfile(profiles, id, name));
    },
    [key, profiles, setProfilesFor],
  );

  const deleteProfile = useCallback(
    (id: string) => {
      if (!key) return;
      setProfilesFor(key, removeLayoutProfile(profiles, id));
    },
    [key, profiles, setProfilesFor],
  );

  const reset = useCallback(() => {
    if (key) {
      resetPref(key);
      return;
    }
    setEphemeral(undefined);
  }, [key, resetPref]);

  const importLegacy = useCallback(() => {
    if (!key) return;
    if (legacyPref) setPref(key, legacyPref);
    if (legacyProfiles?.length)
      setProfilesFor(
        key,
        legacyProfiles.reduce((all, profile) => upsertLayoutProfile(all, profile), profiles),
      );
  }, [key, legacyPref, legacyProfiles, profiles, setPref, setProfilesFor]);

  return {
    hasLegacy: Boolean(legacyPref || legacyProfiles?.length),
    importLegacy,
    order: resolved.order,
    hidden: resolved.hidden,
    pinned: resolved.pinned,
    setOrder,
    setHidden,
    setPinned,
    reset,
    profiles,
    saveProfile,
    applyProfile,
    renameProfile,
    deleteProfile,
    canUseProfiles: key !== null,
    isCustomized: source !== undefined,
  };
}
