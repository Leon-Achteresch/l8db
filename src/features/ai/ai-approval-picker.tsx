import { ShieldCheck } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAiStore } from "@/lib/ai/store";
import type { AiProfile } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "", name: "Immer fragen", hint: "Jedes Tool einzeln freigeben" },
  {
    id: "mcp",
    name: "MCP automatisch",
    hint: "MCP-Tools ohne Rückfrage, Shell und Dateien fragen",
  },
  { id: "all", name: "Alles automatisch", hint: "Alle CLI-Tools ohne Rückfrage" },
] as const;

interface Props {
  profile: AiProfile;
  disabled: boolean;
}
export function AiApprovalPicker({ profile, disabled }: Props) {
  const saveProfile = useAiStore((state) => state.saveProfile);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("ai.chat.approval");
  const current = MODES.find((mode) => mode.id === (profile.approval ?? "")) ?? MODES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={feature.ref}
          type="button"
          aria-label="Freigaben auswählen"
          title={`Freigaben: ${current.name}`}
          disabled={disabled}
          className={cn(
            "flex h-7 min-w-0 shrink items-center gap-1.5 rounded-full px-2 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 data-[state=open]:bg-muted",
            current.id &&
              "bg-amber-500/12 px-2.5 text-amber-900 hover:bg-amber-500/20 dark:text-amber-200",
          )}
        >
          <ShieldCheck className="size-3.5 shrink-0" />
          {current.id && <span className="truncate">{current.name}</span>}
          {feature.isNew && <NewBadge />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-64">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          Freigaben · Datenbank-Änderungen fragen immer
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current.id}
          onValueChange={(approval) => saveProfile({ ...profile, approval })}
        >
          {MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode.id} value={mode.id} className="flex-col items-start">
              <span className="text-xs">{mode.name}</span>
              <span className="text-[11px] text-muted-foreground">{mode.hint}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
