import { TicketIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import {
  findTickets,
  TICKETS_PATH,
  type TicketTracker,
  TRACKER_PRESETS,
} from "@/lib/versioning/review";
import type { TicketsState } from "./use-tickets";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningPopover } from "./versioning-popover";
import { VersioningSelect } from "./versioning-select";
import { VersioningTicketChips } from "./versioning-ticket-chips";

export function VersioningTicketSettings({
  workspace,
  tickets,
}: {
  workspace: VersioningWorkspace;
  tickets: TicketsState;
}) {
  const feature = useNewFeatureVisibility<HTMLParagraphElement>("versioning.tickets");
  const [trackers, setTrackers] = useState<TicketTracker[] | null>(null);
  const [sample, setSample] = useState("");
  const list =
    trackers ?? (tickets.configured ? tickets.configuration.trackers : ([] as TicketTracker[]));
  const update = (index: number, change: Partial<TicketTracker>) =>
    setTrackers(list.map((tracker, at) => (at === index ? { ...tracker, ...change } : tracker)));
  const add = (label: string) => {
    const preset = TRACKER_PRESETS.find((entry) => entry.label === label);
    if (!preset) return;
    let id = preset.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    while (list.some((tracker) => tracker.id === id)) id = `${id}-2`;
    setTrackers([...list, { id, ...preset }]);
  };
  const preview = sample.trim()
    ? findTickets([sample], {
        format: 1,
        trackers: list.length ? list : tickets.configuration.trackers,
      })
    : [];
  return (
    <VersioningPopover icon={TicketIcon} label="Ticket-Systeme" className="w-96">
      <p ref={feature.ref} className="text-[11px] leading-relaxed text-muted-foreground">
        {feature.isNew && <NewBadge />} Ticket-Schlüssel wie{" "}
        <span className="font-mono">SHOP-142</span> werden in Branches, Commits und Pull Requests
        erkannt und verlinkt. Jira, YouTrack, Linear, Azure Boards und jedes System mit eigener
        Adresse funktionieren gleich. Ohne Einrichtung werden Schlüssel im Format{" "}
        <span className="font-mono">ABC-123</span> ohne Link erkannt.
      </p>
      {tickets.problem && <p className="text-[11px] text-destructive">{tickets.problem}</p>}
      <ul className="space-y-3">
        {list.map((tracker, index) => (
          <li key={tracker.id} className="space-y-1.5 rounded-lg bg-muted/35 p-2.5">
            <div className="flex items-center gap-1.5">
              <Input
                aria-label="Name des Ticket-Systems"
                value={tracker.label}
                maxLength={60}
                onChange={(event) => update(index, { label: event.target.value })}
                className="h-7 text-xs font-medium"
              />
              <VersioningIconButton
                icon={Trash2Icon}
                label={`${tracker.label} entfernen`}
                className="size-7"
                onClick={() => setTrackers(list.filter((_, at) => at !== index))}
              />
            </div>
            <Input
              aria-label="Muster für Ticket-Schlüssel (regulärer Ausdruck)"
              placeholder="Muster, z. B. [A-Z]+-\d+"
              value={tracker.pattern}
              onChange={(event) => update(index, { pattern: event.target.value })}
              className="h-7 font-mono text-[11px]"
            />
            <Input
              aria-label="Link-Vorlage mit {key} oder {id}"
              placeholder="https://…/{key}"
              value={tracker.url}
              onChange={(event) => update(index, { url: event.target.value })}
              className="h-7 font-mono text-[11px]"
            />
          </li>
        ))}
      </ul>
      <VersioningSelect
        label="Ticket-System hinzufügen"
        hideLabel
        value=""
        placeholder="Ticket-System hinzufügen…"
        onChange={add}
        options={TRACKER_PRESETS.map((preset) => ({ value: preset.label, label: preset.label }))}
      />
      <div className="space-y-1.5">
        <Input
          aria-label="Erkennung testen"
          placeholder="Erkennung testen, z. B. feature/SHOP-142-rabatt"
          value={sample}
          onChange={(event) => setSample(event.target.value)}
          className="h-7 text-[11px]"
        />
        {sample.trim() &&
          (preview.length ? (
            <VersioningTicketChips tickets={preview} />
          ) : (
            <p className="text-[10px] text-muted-foreground">Kein Ticket erkannt.</p>
          ))}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Gespeichert in <span className="font-mono">{TICKETS_PATH}</span> und mit dem nächsten Commit
        für das ganze Team geteilt.
      </p>
      <Button
        size="sm"
        disabled={trackers === null}
        onClick={() =>
          void workspace.run(async () => {
            await tickets.save({ format: 1, trackers: list });
            setTrackers(null);
          }, "Ticket-Systeme gespeichert")
        }
      >
        Speichern
      </Button>
    </VersioningPopover>
  );
}
