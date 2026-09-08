import { Settings2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { QueryWorkspaceSettings } from "@/features/query/query-workspace-settings";
import { EditorSettingsControls } from "@/features/settings/editor-settings-controls";
import { SettingsHotkeysTab } from "@/features/settings/settings-hotkeys-tab";
import { useSettingsStore } from "@/lib/settings";

export function QueryEditorSettingsPopover() {
  const store = useSettingsStore();
  const [tab, setTab] = useState("workspace");
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3 text-xs"
          title="Query Editor anpassen"
        >
          <Settings2Icon className="size-3.5" />
          Anpassen
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>Query Editor anpassen</SheetTitle>
          <SheetDescription>Dein Code. Deine Werkzeuge. Deine Einstellungen.</SheetDescription>
        </SheetHeader>
        <div
          className="flex flex-wrap gap-1 border-b px-6 py-3"
          role="tablist"
          aria-label="Editor-Einstellungen"
        >
          {[
            ["workspace", "Arbeitsplatz & Ausführung"],
            ["editor", "Editor"],
            ["hotkeys", "Tastenkürzel"],
          ].map(([id, label]) => (
            <Button
              key={id}
              id={`settings-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls="query-settings-content"
              variant={tab === id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div
          id="query-settings-content"
          role="tabpanel"
          aria-labelledby={`settings-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto p-6"
        >
          {tab === "workspace" ? (
            <QueryWorkspaceSettings />
          ) : tab === "hotkeys" ? (
            <SettingsHotkeysTab />
          ) : (
            <EditorSettingsControls store={store} compact />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
