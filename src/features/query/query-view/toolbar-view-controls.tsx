import { Maximize2, Minimize2 } from "lucide";
import { GaugeIcon, PanelBottomIcon, PanelLeftIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
          className="size-8"
          variant={navigatorVisible ? "secondary" : "ghost"}
          aria-label="Schema-Navigator umschalten"
          title="Schema und Statement-Navigator"
          aria-pressed={navigatorVisible}
          onClick={() =>
            afterPaint(() => {
              const workspace = useQueryWorkspace.getState();
              workspace.update({ navigatorVisible: !workspace.navigatorVisible });
            })
          }
        >
          <PanelLeftIcon className="size-3.5" />
        </Button>
      )}
      <Button
        size="sm"
        variant={analysisOpen ? "secondary" : "ghost"}
        className="size-8 px-0"
        aria-pressed={analysisOpen}
        onClick={onOpenAnalysis}
        title="Explain und Performance-Test"
      >
        <GaugeIcon className="size-3.5" />
        <span className="sr-only">Analyse</span>
      </Button>
      <Separator orientation="vertical" className="mx-1 my-2" />
      <Button
        size="icon-sm"
        className="size-8"
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
        className="size-8"
        variant={resultFocus ? "secondary" : "ghost"}
        title="Ergebnis vergrößern umschalten"
        aria-label="Ergebnis vergrößern umschalten"
        aria-pressed={resultFocus}
        onClick={onResultFocusChange}
      >
        <PanelBottomIcon className="size-3.5" />
      </Button>
      <Separator orientation="vertical" className="mx-1 my-2" />
      <QueryEditorSettingsPopover />
      {toolsMenu}
    </div>
  );
}
