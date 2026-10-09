import {
  ClockIcon,
  GaugeIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LIVE_INTERVALS, LIVE_RANGES, type LiveInterval, type LiveRange } from "@/lib/live-monitor";
import type { LiveMonitorState } from "./use-live-monitor";

function rangeLabel(minutes: number): string {
  return minutes >= 60 ? "Letzte Stunde" : `Letzte ${minutes} Minuten`;
}

export function LiveMonitorToolbar({
  m,
  onOpenHistory,
  onOpenWorkload,
}: {
  m: LiveMonitorState;
  onOpenHistory: () => void;
  onOpenWorkload: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={String(m.range)}
        onValueChange={(value) => m.setRange(Number(value) as LiveRange)}
      >
        <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Zeitraum">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LIVE_RANGES.map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {rangeLabel(minutes)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(m.interval)}
        onValueChange={(value) => m.setInterval(Number(value) as LiveInterval)}
      >
        <SelectTrigger size="sm" className="h-8 w-28 text-xs" aria-label="Aktualisierungsintervall">
          <ClockIcon className="size-3.5" />
          <span>Auto</span>
          <span className="text-muted-foreground">
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {LIVE_INTERVALS.map((ms) => (
            <SelectItem key={ms} value={String(ms)}>
              {ms / 1000} s
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="icon-sm"
        variant={m.paused ? "outline" : "default"}
        onClick={() => m.setPaused(!m.paused)}
        aria-label={m.paused ? "Aktualisierung fortsetzen" : "Aktualisierung pausieren"}
        title={m.paused ? "Aktualisierung fortsetzen" : "Aktualisierung pausieren"}
      >
        {m.paused ? <PlayIcon /> : <PauseIcon />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Weitere Monitor-Aktionen">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={m.refresh}>
            <RefreshCwIcon />
            Jetzt aktualisieren
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenHistory}>
            <GaugeIcon />
            Query-Verlauf
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenWorkload}>
            <ListChecksIcon />
            Workload
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
