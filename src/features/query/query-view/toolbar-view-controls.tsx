import { Maximize2, Minimize2 } from "lucide";
import { GaugeIcon, PanelBottomIcon, PanelLeftIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { QueryEditorSettingsPopover } from "@/features/query/query-editor-settings-popover";
import { afterPaint } from "@/lib/after-paint";
import { useQueryWorkspace } from "@/lib/query-workspace";

interface ToolbarViewControlsProps {
  isSql: boolean;
  analysisOpen: boolean;
  onOpenAnalysis: () => void;
  editorFocus: boolean;
  onEditorFocusChange: (focus: boolean) => void;
  resultFocus: boolean;
  onResultFocusChange: () => void;
  toolsMenu: ReactNode;
}

export function ToolbarViewControls({
  isSql,
  analysisOpen,
  onOpenAnalysis,
  editorFocus,
  onEditorFocusChange,
  resultFocus,
  onResultFocusChange,
  toolsMenu,
}: ToolbarViewControlsProps) {
  const navigatorVisible = useQueryWorkspace((state) => state.navigatorVisible);
  return (
    <div className="flex shrink-0 items-center gap-1">
      {isSql && (
        <Button
          size="icon-sm"
          variant={navigatorVisible ? "secondary" : "ghost"}
          aria-label="Schema-Navigator umschalten"
          title="Schema und Statement-Navigator"
          aria-pressed={navigatorVisible}
          onClick={() => {
            const next = !navigatorVisible;
            afterPaint(() => useQueryWorkspace.getState().update({ navigatorVisible: next }));
          }}
        >
          <PanelLeftIcon className="size-3.5" />
        </Button>
      )}
      <Button
        size="sm"
        variant={analysisOpen ? "secondary" : "ghost"}
        className="h-7 gap-1.5 px-2 text-xs @min-[62rem]/qtb:px-3"
        aria-pressed={analysisOpen}
        onClick={onOpenAnalysis}
        title="Explain und Performance-Test"
      >
        <GaugeIcon className="size-3.5" />
        <span className="sr-only @min-[62rem]/qtb:not-sr-only">Analyse</span>
      </Button>
      <Button
        size="icon-sm"
        variant={editorFocus ? "secondary" : "ghost"}
        title="Editor-Fokus umschalten"
        aria-label="Editor-Fokus umschalten"
        aria-pressed={editorFocus}
        onClick={() => onEditorFocusChange(!editorFocus)}
      >
        <MorphIcon icon={editorFocus ? Minimize2 : Maximize2} className="size-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant={resultFocus ? "secondary" : "ghost"}
        title="Ergebnis vergrößern umschalten"
        aria-label="Ergebnis vergrößern umschalten"
        aria-pressed={resultFocus}
        onClick={onResultFocusChange}
      >
        <PanelBottomIcon className="size-3.5" />
      </Button>
      <QueryEditorSettingsPopover />
      {toolsMenu}
    </div>
  );
}
