import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ObjectPicker } from "@/features/users/principal-view/object-picker";
import { OBJECT_PRIVILEGES } from "@/features/users/principal-view/object-privileges";
import type { GrantableObject, ObjectGrant } from "@/lib/db";
import { cn } from "@/lib/utils";

interface ObjectGrantFormProps {
  owners: string[];
  allowGrantOption: boolean;
  onAdd: (grants: ObjectGrant[]) => void;
}

export function ObjectGrantForm({ owners, allowGrantOption, onAdd }: ObjectGrantFormProps) {
  const [owner, setOwner] = useState("");
  const [object, setObject] = useState<GrantableObject | null>(null);
  const [privileges, setPrivileges] = useState<string[]>([]);
  const [grantable, setGrantable] = useState(false);
  const offered = object ? (OBJECT_PRIVILEGES[object.object_type] ?? []) : [];

  const add = () => {
    if (!object) return;
    onAdd(
      privileges.map((privilege) => ({
        owner,
        object: object.name,
        object_type: object.object_type,
        privilege,
        column: null,
        grantable: allowGrantOption && grantable,
        grantor: "",
      })),
    );
    setPrivileges([]);
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <Select
          value={owner}
          onValueChange={(next) => {
            setOwner(next);
            setObject(null);
            setPrivileges([]);
          }}
        >
          <SelectTrigger size="sm" className="w-48 font-mono text-xs" aria-label="Schema">
            <SelectValue placeholder="Schema" />
          </SelectTrigger>
          <SelectContent>
            {owners.map((name) => (
              <SelectItem key={name} value={name} className="font-mono text-xs">
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ObjectPicker
          owner={owner}
          value={object}
          onChange={(next) => {
            setObject(next);
            setPrivileges([]);
          }}
        />
        <Button size="sm" disabled={privileges.length === 0} onClick={add}>
          <PlusIcon data-icon="inline-start" />
          Erteilen
        </Button>
      </div>
      {object && (
        <div className="flex flex-wrap items-center gap-1.5">
          {offered.map((privilege) => {
            const active = privileges.includes(privilege);
            return (
              <Button
                key={privilege}
                size="xs"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                className={cn("rounded-full font-mono text-[11px]", !active && "bg-background")}
                onClick={() =>
                  setPrivileges(
                    active
                      ? privileges.filter((name) => name !== privilege)
                      : [...privileges, privilege],
                  )
                }
              >
                {privilege}
              </Button>
            );
          })}
          {allowGrantOption && (
            <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={grantable} onCheckedChange={(on) => setGrantable(on === true)} />
              Grant Option
            </label>
          )}
        </div>
      )}
    </div>
  );
}
