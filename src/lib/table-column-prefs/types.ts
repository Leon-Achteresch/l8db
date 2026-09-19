export type TableColumnPref = {
  order: string[];
  hidden: string[];
  pinned?: string[];
};

export type ResolvedColumnPref = {
  order: string[];
  hidden: string[];
  pinned: string[];
};

export type TableLayoutProfile = {
  id: string;
  name: string;
  order: string[];
  hidden: string[];
  pinned: string[];
};

export interface TableColumnPrefsState {
  prefs: Record<string, TableColumnPref>;
  profiles: Record<string, TableLayoutProfile[]>;
  setPref: (key: string, pref: TableColumnPref) => void;
  resetPref: (key: string) => void;
  setProfiles: (key: string, profiles: TableLayoutProfile[]) => void;
}
