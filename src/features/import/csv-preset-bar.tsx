import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type CsvMappingPreset, useCsvMappingPresets } from "@/lib/csv-mapping-presets";
export function CsvPresetBar({
  value,
  onLoad,
}: {
  value: Omit<CsvMappingPreset, "id" | "name">;
  onLoad: (preset: CsvMappingPreset) => void;
}) {
  const presets = useCsvMappingPresets((state) => state.presets);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <select
        aria-label="Mappingvorlage"
        className="max-w-64 rounded border bg-background px-2 text-xs"
        value={id}
        onChange={(event) => setId(event.target.value)}
      >
        <option value="">Mappingvorlage</option>
        {presets
          .filter((preset) => preset.scope === value.scope)
          .map((preset) => (
            <option value={preset.id} key={preset.id}>
              {preset.name}
            </option>
          ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!id}
        onClick={() => {
          const preset = presets.find((entry) => entry.id === id && entry.scope === value.scope);
          if (preset) onLoad(preset);
        }}
      >
        Anwenden
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!id}
        onClick={() => {
          useCsvMappingPresets.setState({ presets: presets.filter((entry) => entry.id !== id) });
          setId("");
        }}
      >
        Entfernen
      </Button>
      <Input
        className="w-40"
        aria-label="Vorlagenname"
        placeholder="Vorlagenname"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        size="sm"
        disabled={!name.trim()}
        onClick={() => {
          useCsvMappingPresets.setState({
            presets: [
              { ...value, id: crypto.randomUUID(), name: name.trim() },
              ...presets.filter(
                (entry) => entry.scope !== value.scope || entry.name !== name.trim(),
              ),
            ].slice(0, 100),
          });
          toast.success("Mappingvorlage gespeichert");
        }}
      >
        Speichern
      </Button>
    </div>
  );
}
