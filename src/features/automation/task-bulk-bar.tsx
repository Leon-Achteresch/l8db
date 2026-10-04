import { DownloadIcon, PauseIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IconButton } from "@/components/icon-button";
import { useAutomationStore } from "@/lib/automation/store";
import { EASE_OUT } from "@/lib/ease";
import { useTaskActions } from "./use-task-actions";

export function TaskBulkBar() {
  const selection = useAutomationStore((state) => state.selection);
  const setSelection = useAutomationStore((state) => state.setSelection);
  const actions = useTaskActions();
  const reduce = useReducedMotion();
  const hidden = reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)" };
  const shown = reduce ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" };

  return (
    <AnimatePresence initial={false}>
      {selection.length > 0 && (
        <motion.div
          key="bulk"
          role="toolbar"
          aria-label="Sammelaktionen"
          initial={hidden}
          animate={shown}
          exit={{ ...hidden, transition: { duration: 0.12, ease: EASE_OUT } }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="shrink-0 border-t bg-background/95 px-2 py-2"
        >
          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium tabular-nums">
              {selection.length} ausgewählt
            </span>
            <IconButton
              size="icon-sm"
              variant="ghost"
              aria-label="Aktivieren"
              onClick={() => void actions.setEnabled(selection, true)}
            >
              <PlayIcon />
            </IconButton>
            <IconButton
              size="icon-sm"
              variant="ghost"
              aria-label="Pausieren"
              onClick={() => void actions.setEnabled(selection, false)}
            >
              <PauseIcon />
            </IconButton>
            <IconButton
              size="icon-sm"
              variant="ghost"
              aria-label="Exportieren"
              onClick={() => void actions.exportTasks(selection)}
            >
              <DownloadIcon />
            </IconButton>
            <IconButton
              size="icon-sm"
              variant="ghost"
              aria-label="Löschen"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => actions.remove(selection)}
            >
              <Trash2Icon />
            </IconButton>
            <IconButton
              size="icon-sm"
              variant="ghost"
              aria-label="Auswahl aufheben"
              onClick={() => setSelection([])}
            >
              <XIcon />
            </IconButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
