import { Link } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw, Unplug } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/icon-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BaasStudioHeader({
  label,
  items,
  value,
  onSelect,
  onRefresh,
  refreshing,
  onDisconnect,
  busy,
  error,
  children,
}: {
  label: string;
  items: { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  onDisconnect: () => void;
  busy?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 space-y-2 border-b pb-3">
      <div className="flex items-center gap-1">
        <Link
          to="/connections"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          Verbindungen
        </Link>
        <IconButton
          aria-label="Aktualisieren"
          variant="ghost"
          size="icon-sm"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </IconButton>
        <IconButton
          aria-label="Trennen"
          variant="ghost"
          size="icon-sm"
          onClick={onDisconnect}
          disabled={busy}
        >
          <Unplug className="size-3.5" />
        </IconButton>
      </div>
      <Select value={value} onValueChange={onSelect}>
        <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
