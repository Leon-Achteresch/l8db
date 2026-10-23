import { Link } from "@tanstack/react-router";
import { ChevronsUpDown, Database } from "lucide-react";
import type { ReactNode } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function BaasStudioHeader({
  provider,
  label,
  items,
  value,
  onSelect,
  error,
  children,
}: {
  provider: string;
  label: string;
  items: { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
  error?: string | null;
  children?: ReactNode;
}) {
  const current = items.find((item) => item.id === value)?.label;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${current ?? ""}`}
            className="flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3 text-left text-xs text-foreground shadow-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ProviderLogo providerId={provider} className="size-4" />
            <span className="min-w-0 flex-1 truncate">{current}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          <DropdownMenuRadioGroup value={value} onValueChange={onSelect}>
            {items.map((item) => (
              <DropdownMenuRadioItem key={item.id} value={item.id} className="text-xs">
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {children}
          <DropdownMenuItem asChild className="text-xs">
            <Link to="/connections">
              <Database className="size-3.5" />
              Alle Verbindungen
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="mt-2 px-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
