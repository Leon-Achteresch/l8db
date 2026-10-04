import { CheckIcon, PaletteIcon } from "lucide-react";
import { useId } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

const RULE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function RuleColorPopover({
  color,
  setColor,
  ruleMode,
  setRuleMode,
}: {
  color: string;
  setColor: (value: string) => void;
  ruleMode: boolean;
  setRuleMode: (value: boolean) => void;
}) {
  const switchId = useId();
  const feature = useNewFeatureVisibility<HTMLButtonElement>("table.filter.rules");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          ref={feature.ref}
          variant={ruleMode ? "secondary" : "ghost"}
          size="icon-sm"
          className="relative ml-auto shrink-0"
          title="Zeilen farbig markieren"
          aria-label="Zeilen farbig markieren"
        >
          <PaletteIcon className="size-4" style={ruleMode ? { color } : undefined} />
          {feature.isNew && <NewBadge className="absolute -top-1.5 -right-2" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Farbregel</PopoverTitle>
          <PopoverDescription>
            Zeilen, die die Bedingungen erfüllen, werden in dieser Farbe markiert.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-wrap items-center gap-1.5">
          {RULE_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              aria-label={`Farbe ${swatch}`}
              aria-pressed={color === swatch}
              className={cn(
                "grid size-6 place-items-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-ring",
                color === swatch &&
                  "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background",
              )}
              style={{ backgroundColor: swatch }}
            >
              {color === swatch && <CheckIcon className="size-3.5" />}
            </button>
          ))}
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            aria-label="Eigene Farbe"
            className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={switchId} className="text-sm font-normal">
            Als Regel statt Filter
          </Label>
          <Switch id={switchId} checked={ruleMode} onCheckedChange={setRuleMode} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
