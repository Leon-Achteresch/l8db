import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAutomationStore } from "@/lib/automation/store";
import { TASK_TEMPLATES, type TaskTemplate } from "@/lib/automation/templates";
import { TemplateCard } from "./template-card";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplatePickerDialog({ open, onOpenChange }: Props) {
  const openDraft = useAutomationStore((state) => state.openDraft);
  const pick = (template: TaskTemplate) => {
    openDraft(template.build());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="automation-template-picker">
        <DialogHeader>
          <DialogTitle>Task aus Vorlage</DialogTitle>
          <DialogDescription>
            Vorlagen sind vollständig vorbereitet. Du wählst danach nur noch Verbindung und Pfade.
          </DialogDescription>
        </DialogHeader>
        {TASK_TEMPLATES.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Keine Vorlagen verfügbar.
          </p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-1 gap-2.5 overflow-y-auto p-0.5 sm:grid-cols-2">
            {TASK_TEMPLATES.map((template) => (
              <TemplateCard key={template.id} template={template} onPick={pick} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
