import { useHotkeys } from "@tanstack/react-hotkeys";
import { memo, useMemo } from "react";
import { commandById } from "@/lib/hotkeys";

type Props = {
  bindings: { id: string; requiresConnection?: boolean }[];
  easyMode: boolean;
  connected: boolean;
  overrides: Record<string, string | undefined>;
  inQueryRoute: boolean;
  run: (id: string) => void;
};

export const AppHotkeyBindings = memo(function AppHotkeyBindings({
  bindings,
  easyMode,
  connected,
  overrides,
  inQueryRoute,
  run,
}: Props) {
  const hotkeys = useMemo(
    () =>
      bindings.flatMap((entry) => {
        const command = commandById(entry.id);
        if (!command) return [];
        const baseEnabled =
          !(easyMode && entry.id === "view.split") && (!entry.requiresConnection || connected);
        const refreshEnabled = baseEnabled && !(inQueryRoute && connected);
        const options = (enabled: boolean) => ({
          enabled,
          ignoreInputs: command.ignoreInputs ?? false,
          preventDefault: true,
          stopPropagation: true,
        });
        const callback = () => run(entry.id);
        const override = overrides[entry.id];
        const rows = [
          {
            hotkey: (override ?? command.defaultHotkey) as never,
            callback,
            options: options(
              entry.id === "app.refresh" && !override ? refreshEnabled : baseEnabled,
            ),
          },
        ];
        if (!override) {
          for (const alias of command.aliases ?? []) {
            rows.push({
              hotkey: alias as never,
              callback,
              options: options(entry.id === "app.refresh" ? refreshEnabled : baseEnabled),
            });
          }
        }
        return rows;
      }),
    [bindings, easyMode, connected, overrides, inQueryRoute, run],
  );
  useHotkeys(hotkeys, { preventDefault: true, stopPropagation: true });
  return null;
});
