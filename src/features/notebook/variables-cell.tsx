import { PlusIcon, XIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BIND_PARAM_TYPE_LABELS, BIND_PARAM_TYPES, type BindParamType } from "@/lib/bind-params";
import type { NotebookVariable } from "@/lib/notebook";

export function VariablesCell({
  variables,
  onChange,
}: {
  variables: NotebookVariable[];
  onChange: (variables: NotebookVariable[]) => void;
}) {
  const patch = (index: number, next: Partial<NotebookVariable>) =>
    onChange(variables.map((v, i) => (i === index ? { ...v, ...next } : v)));
  return (
    <div className="grid">
      <div className="flex h-9 items-center gap-2 border-b px-3">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          Variablen
        </span>
        <span
          className="ml-auto font-mono text-[11px] text-muted-foreground"
          title="In SQL-Zellen darunter als Bind-Parameter :name oder als Textbaustein ${name} verwenden"
        >
          :name · {"${name}"}
        </span>
      </div>
      <div className="grid gap-1.5 p-3">
        {variables.map((variable, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Variablenname"
              placeholder="name"
              className="h-7 w-40 font-mono text-xs"
              value={variable.name}
              onChange={(event) => patch(index, { name: event.target.value.replace(/[^\w]/g, "") })}
            />
            <Select
              value={variable.type}
              onValueChange={(type) => patch(index, { type: type as BindParamType })}
            >
              <SelectTrigger size="sm" aria-label="Typ" className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BIND_PARAM_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {BIND_PARAM_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Wert"
              placeholder="Wert"
              className="h-7 min-w-32 flex-1 text-xs"
              disabled={variable.type === "null"}
              value={variable.value}
              onChange={(event) => patch(index, { value: event.target.value })}
            />
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Variable entfernen"
              onClick={() => onChange(variables.filter((_, i) => i !== index))}
            >
              <XIcon />
            </IconButton>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={() => onChange([...variables, { name: "", type: "text", value: "" }])}
          >
            <PlusIcon className="size-3.5" /> Variable
          </Button>
        </div>
      </div>
    </div>
  );
}
