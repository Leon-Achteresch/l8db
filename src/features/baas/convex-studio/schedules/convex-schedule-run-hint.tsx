import { CalendarPlus, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConvexSchedulableFunction } from "@/lib/db/convex-studio-schedules";

function reference(fn: ConvexSchedulableFunction) {
  const [module, name = "default"] = fn.function.split(":");
  return `${fn.internal ? "internal" : "api"}.${module.replaceAll("/", ".")}.${name}`;
}

export function ConvexScheduleRunHint({ functions }: { functions: ConvexSchedulableFunction[] }) {
  const [path, setPath] = useState<string>("");
  const [delay, setDelay] = useState("60000");
  const [args, setArgs] = useState("{}");
  const fn = functions.find((item) => item.udfPath === path) ?? functions[0];
  const snippet = fn
    ? `await ctx.scheduler.runAfter(${Number(delay) || 0}, ${reference(fn)}, ${args.trim() || "{}"});`
    : "";

  return (
    <Collapsible className="rounded-xl border p-3 text-xs">
      <CollapsibleTrigger className="flex items-center gap-2 font-medium">
        <CalendarPlus className="size-3.5" /> Neuen Lauf einplanen
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        <p className="text-muted-foreground">
          Die Convex-Admin-API kann keine Funktionen einplanen; das geht nur über{" "}
          <code>ctx.scheduler.runAfter</code> oder <code>ctx.scheduler.runAt</code> in einer
          Mutation oder Action deiner App. Stelle den Aufruf hier zusammen und füge ihn in eine
          Mutation ein, die du anschließend unter „Funktionen“ ausführst. Für einen sofortigen Lauf
          kannst du die Funktion dort auch direkt aufrufen.
        </p>
        <div className="flex flex-wrap gap-2">
          <Select value={fn?.udfPath ?? ""} onValueChange={setPath}>
            <SelectTrigger size="sm" className="h-8 w-64 text-xs" aria-label="Funktion">
              <SelectValue placeholder="Funktion" />
            </SelectTrigger>
            <SelectContent>
              {functions.map((item) => (
                <SelectItem key={item.udfPath} value={item.udfPath} className="font-mono text-xs">
                  {item.function}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-8 w-40 text-xs"
            inputMode="numeric"
            value={delay}
            onChange={(event) => setDelay(event.target.value.replace(/\D/g, ""))}
            aria-label="Verzögerung in Millisekunden"
            placeholder="Verzögerung (ms)"
          />
          <Input
            className="h-8 min-w-48 flex-1 font-mono text-xs"
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            aria-label="Argumente als JSON"
          />
        </div>
        {snippet && (
          <div className="flex items-start gap-2">
            <pre className="flex-1 overflow-auto rounded-md border bg-muted/40 p-2 font-mono">
              {snippet}
            </pre>
            <Button
              size="icon-xs"
              variant="outline"
              aria-label="Kopieren"
              onClick={() =>
                navigator.clipboard.writeText(snippet).then(() => toast.success("Kopiert"))
              }
            >
              <Copy />
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
