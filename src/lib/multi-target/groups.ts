import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";
import { type MultiTarget, multiTarget } from "./run";

export interface MultiTargetGroup {
  id: string;
  name: string;
  targets: MultiTarget[];
  updatedAt: number;
}

interface MultiTargetGroupsState {
  groups: MultiTargetGroup[];
  save: (name: string, targets: MultiTarget[]) => MultiTargetGroup | null;
  remove: (id: string) => void;
}

export const MULTI_TARGET_GROUP_LIMITS = { groups: 100, targets: 500, nameLength: 80 };

function normalizeTargets(targets: unknown): MultiTarget[] {
  if (!Array.isArray(targets)) return [];
  const seen = new Set<string>();
  const result: MultiTarget[] = [];
  for (const entry of targets) {
    if (!entry || typeof entry !== "object") continue;
    const { connectionId, database, schema } = entry as Partial<MultiTarget>;
    if (typeof connectionId !== "string" || !connectionId) continue;
    const target = multiTarget(
      connectionId,
      typeof database === "string" ? database : null,
      typeof schema === "string" ? schema : null,
    );
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    result.push(target);
    if (result.length >= MULTI_TARGET_GROUP_LIMITS.targets) break;
  }
  return result;
}

export function normalizeGroups(groups: unknown): MultiTargetGroup[] {
  if (!Array.isArray(groups)) return [];
  return groups
    .flatMap((group): MultiTargetGroup[] => {
      if (!group || typeof group !== "object") return [];
      const { id, name, targets, updatedAt } = group as Partial<MultiTargetGroup>;
      if (typeof id !== "string" || typeof name !== "string" || !name.trim()) return [];
      return [
        {
          id,
          name: name.slice(0, MULTI_TARGET_GROUP_LIMITS.nameLength),
          targets: normalizeTargets(targets),
          updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
        },
      ];
    })
    .slice(0, MULTI_TARGET_GROUP_LIMITS.groups);
}

export const useMultiTargetGroups = create<MultiTargetGroupsState>()(
  persist(
    (set, get) => ({
      groups: [],
      save: (name, targets) => {
        const trimmed = name.trim().slice(0, MULTI_TARGET_GROUP_LIMITS.nameLength);
        const normalized = normalizeTargets(targets);
        if (!trimmed || !normalized.length) return null;
        const existing = get().groups.find(
          (group) => group.name.toLowerCase() === trimmed.toLowerCase(),
        );
        const group: MultiTargetGroup = {
          id: existing?.id ?? crypto.randomUUID(),
          name: trimmed,
          targets: normalized,
          updatedAt: Date.now(),
        };
        set((state) => ({
          groups: [group, ...state.groups.filter((entry) => entry.id !== group.id)].slice(
            0,
            MULTI_TARGET_GROUP_LIMITS.groups,
          ),
        }));
        return group;
      },
      remove: (id) => set((state) => ({ groups: state.groups.filter((group) => group.id !== id) })),
    }),
    {
      name: "l8db.multi-target-groups",
      version: 1,
      partialize: (state) => ({ groups: state.groups }),
      merge: (persisted, current) => ({
        ...current,
        groups: normalizeGroups((persisted as { groups?: unknown } | undefined)?.groups),
      }),
    },
  ),
);

syncAcrossWindows("l8db.multi-target-groups", () => void useMultiTargetGroups.persist.rehydrate());
