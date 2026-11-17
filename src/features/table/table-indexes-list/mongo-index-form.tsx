import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { EMPTY_MONGO_INDEX, type MongoIndexSpec, mongoIndexCommand } from "@/lib/mongo-index";

export function MongoIndexForm({
  collection,
  onCommand,
}: {
  collection: string;
  onCommand: (command: string) => void;
}) {
  const [spec, setSpec] = useState<MongoIndexSpec>(EMPTY_MONGO_INDEX);
  const feature = useNewFeatureVisibility<HTMLDivElement>("table.structure.indexes.mongo-form");
  const update = (patch: Partial<MongoIndexSpec>) => {
    const next = { ...spec, ...patch };
    setSpec(next);
    onCommand(mongoIndexCommand(collection, next));
  };

  return (
    <div ref={feature.ref} className="grid grid-cols-2 gap-x-3 gap-y-2">
      <div className="grid gap-1">
        <Label htmlFor="mongo-index-field" className="text-xs">
          Feld {feature.isNew && <NewBadge className="ml-1" />}
        </Label>
        <Input
          id="mongo-index-field"
          className="h-8 font-mono text-xs"
          placeholder="status"
          value={spec.field}
          onChange={(event) => update({ field: event.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">Richtung</Label>
        <Select
          value={spec.direction}
          onValueChange={(value) => update({ direction: value as MongoIndexSpec["direction"] })}
        >
          <SelectTrigger size="sm" aria-label="Richtung">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Aufsteigend (1)</SelectItem>
            <SelectItem value="-1">Absteigend (-1)</SelectItem>
            <SelectItem value="text">Text</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="mongo-index-name" className="text-xs">
          Name
        </Label>
        <Input
          id="mongo-index-name"
          className="h-8 font-mono text-xs"
          placeholder="automatisch"
          value={spec.name}
          onChange={(event) => update({ name: event.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="mongo-index-ttl" className="text-xs">
          TTL (Sekunden)
        </Label>
        <Input
          id="mongo-index-ttl"
          className="h-8 font-mono text-xs"
          inputMode="numeric"
          placeholder="—"
          value={spec.ttl}
          onChange={(event) => update({ ttl: event.target.value.replace(/\D/g, "") })}
        />
      </div>
      <Label className="col-span-2 flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox
          checked={spec.unique}
          onCheckedChange={(checked) => update({ unique: checked === true })}
        />
        Eindeutig (unique)
      </Label>
    </div>
  );
}
