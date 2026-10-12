import { Maximize2, Minimize2 } from "lucide";
import { GaugeIcon, PanelBottomIcon, PanelLeftIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { QueryEditorSettingsPopover } from "@/features/query/query-editor-settings-popover";

import type { QueryWorkspaceState } from "./types";

interface ToolbarViewControlsProps {
  workspace: QueryWorkspaceState;
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
  workspace,
  isSql,
  analysisOpen,
  onOpenAnalysis,
  editorFocus,
  onEditorFocusChange,
  resultFocus,
  onResultFocusChange,
  toolsMenu,
}: ToolbarViewControlsProps) {
  return (
    <div className="ml-auto flex items-center gap-1">
      {isSql && (
        <Button
          size="icon-sm"
          variant={workspace.navigatorVisible ? "secondary" : "ghost"}
          aria-label="Schema-Navigator umschalten"
          title="Schema und Statement-Navigator"
          aria-pressed={workspace.navigatorVisible}
          onClick={() => workspace.update({ navigatorVisible: !workspace.navigatorVisible })}
        >
          <PanelLeftIcon className="size-3.5" />
        </Button>
      )}
      <Button
        size="sm"
        variant={analysisOpen ? "secondary" : "ghost"}
        className="h-7 gap-1.5 text-xs"
        aria-pressed={analysisOpen}
        onClick={onOpenAnalysis}
        title="Explain und Performance-Test"
      >
        <GaugeIcon className="size-3.5" />
        Analyse
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
