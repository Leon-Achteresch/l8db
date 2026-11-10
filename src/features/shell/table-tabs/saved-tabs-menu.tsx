import { useHotkey } from "@tanstack/react-hotkeys";
import {
  BookmarkIcon,
  ClipboardPasteIcon,
  Link2Icon,
  SquareTerminalIcon,
  TableIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { formatHotkeyDisplay, useResolvedHotkey } from "@/lib/hotkeys";
import { useHasNewFeatures } from "@/lib/new-features";
import { useSavedTabsStore } from "@/lib/saved-tabs";
import { copySharedTabLink, openLinkFromClipboard, requestSharedTab } from "@/lib/shared-tab-open";
import { listenForSharedTabLinks } from "@/lib/shared-tab-paste";
import { sharedTabSource } from "@/lib/shared-tabs";
import { iconButton } from "./constants";

export function SavedTabsMenu() {
  const saved = useSavedTabsStore((state) => state.saved);
  const removeTab = useSavedTabsStore((state) => state.removeTab);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("workspace.saved-tabs");
  const linkFeature = useNewFeatureVisibility<HTMLDivElement>("workspace.saved-tabs.paste-link");
  const linkNew = useHasNewFeatures("workspace.saved-tabs.paste-link");
  const openLinkHotkey = useResolvedHotkey("tab.openLink");
  useHotkey(openLinkHotkey, () => void openLinkFromClipboard(), { ignoreInputs: true });
  useEffect(listenForSharedTabLinks, []);
  const label = saved.length ? `Gespeicherte Tabs (${saved.length})` : "Gespeicherte Tabs";
  return (
    <DropdownMenu>
      <Tooltip content={label} side="bottom" wrapperClassName="shrink-0">
        <DropdownMenuTrigger asChild>
          <button
            data-feature="workspace.saved-tabs"
            ref={feature.ref}
            type="button"
            aria-label={label}
            className={`${iconButton} relative ${saved.length ? "w-11 gap-0.5" : ""}`}
          >
            <BookmarkIcon className="size-3.5" />
            {saved.length > 0 && <span className="text-[10px] tabular-nums">{saved.length}</span>}
            {(feature.isNew || linkNew) && <NewBadge className="absolute -top-1.5 left-4" />}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuItem ref={linkFeature.ref} onSelect={() => void openLinkFromClipboard()}>
          <ClipboardPasteIcon className="size-3.5 text-muted-foreground" />
          <span className="flex-1">Link öffnen</span>
          {linkFeature.isNew && <NewBadge />}
          <DropdownMenuShortcut>{formatHotkeyDisplay(openLinkHotkey)}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {saved.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Gespeicherte Tabs</DropdownMenuLabel>
          </>
        )}
        {saved.map((entry) => {
          const Icon = entry.tab.kind === "table" ? TableIcon : SquareTerminalIcon;
          return (
            <div key={entry.id} className="flex items-center gap-0.5">
              <DropdownMenuItem
                onSelect={() => requestSharedTab(entry.tab, "saved")}
                title={`${entry.name}: ${sharedTabSource(entry.tab)}`}
                className="min-w-0 flex-1"
              >
                <Icon className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{entry.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {sharedTabSource(entry.tab)}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void copySharedTabLink(entry.tab)}
                aria-label={`Link zu ${entry.name} kopieren`}
                className="shrink-0 text-muted-foreground"
              >
                <Link2Icon className="size-3.5" />
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  removeTab(entry.id);
                }}
                aria-label={`${entry.name} löschen`}
                className="shrink-0 text-muted-foreground"
              >
                <Trash2Icon className="size-3.5" />
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
