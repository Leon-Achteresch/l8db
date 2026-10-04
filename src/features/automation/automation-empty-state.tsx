import {
  BellRingIcon,
  CalendarClockIcon,
  LayoutTemplateIcon,
  ListChecksIcon,
  PlusIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { newTask } from "@/lib/automation/defaults";
import { useAutomationStore } from "@/lib/automation/store";
import { TASK_TEMPLATES, type TaskTemplate } from "@/lib/automation/templates";
import { EASE_OUT } from "@/lib/ease";
import { TemplateCard } from "./template-card";
import { TemplatePickerDialog } from "./template-picker-dialog";

const FEATURED = ["nightly-backup", "daily-csv-report", "query-alert"];

const FLOW = [
  { icon: ListChecksIcon, title: "Schritte", text: "SQL, Export, Backup, Prüfung" },
  { icon: CalendarClockIcon, title: "Zeitplan", text: "Intervall, täglich, Cron" },
  { icon: BellRingIcon, title: "Benachrichtigung", text: "System, E-Mail, Slack" },
];

export function AutomationEmptyState() {
  const openDraft = useAutomationStore((state) => state.openDraft);
  const reduce = useReducedMotion();
  const [picker, setPicker] = useState(false);
  const featured = [
    ...FEATURED.map((id) => TASK_TEMPLATES.find((template) => template.id === id)),
    ...TASK_TEMPLATES,
  ]
    .filter((template, index, all): template is TaskTemplate =>
      Boolean(template && all.indexOf(template) === index),
    )
    .slice(0, 3);
  const rise = (index: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
      : {
          initial: { opacity: 0, transform: "translateY(8px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.32, ease: EASE_OUT, delay: 0.04 * index },
        };

  return (
    <div
      data-testid="automation-empty-state"
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto px-6 py-10"
    >
      <div className="m-auto flex w-full max-w-2xl flex-col gap-8">
        <motion.div {...rise(0)} className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            Wiederkehrende Arbeit automatisieren
          </h1>
          <p className="max-w-[60ch] text-sm leading-relaxed text-pretty text-muted-foreground">
            Plane Backups, Exporte, Prüfungen und Skripte. l8db führt sie aus, solange die App läuft
            – oder im Hintergrund.
          </p>
        </motion.div>

        <motion.ol
          {...rise(1)}
          aria-label="So funktioniert ein Task"
          className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3"
        >
          {FLOW.map((entry) => (
            <li key={entry.title} className="flex items-start gap-2.5 bg-card px-3.5 py-3">
              <entry.icon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-fuchsia-600 dark:text-fuchsia-400"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium">{entry.title}</span>
                <span className="text-xs text-muted-foreground">{entry.text}</span>
              </span>
            </li>
          ))}
        </motion.ol>

        <div className="flex flex-col gap-3">
          <motion.h2 {...rise(2)} className="text-[13px] font-semibold">
            Mit einer Vorlage beginnen
          </motion.h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {featured.map((template, index) => (
              <motion.div key={template.id} {...rise(3 + index)}>
                <TemplateCard template={template} onPick={(picked) => openDraft(picked.build())} />
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div {...rise(6)} className="flex flex-wrap items-center gap-2">
          <Button onClick={() => openDraft(newTask())} data-testid="automation-empty-blank">
            <PlusIcon />
            Leeren Task anlegen
          </Button>
          <Button variant="outline" onClick={() => setPicker(true)}>
            <LayoutTemplateIcon />
            Aus Vorlage
          </Button>
        </motion.div>
      </div>
      <TemplatePickerDialog open={picker} onOpenChange={setPicker} />
    </div>
  );
}
