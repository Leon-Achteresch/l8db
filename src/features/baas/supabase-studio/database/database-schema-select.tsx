import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type DbSchema, supabaseStudioDatabaseList } from "@/lib/db/supabase-studio-database";
import { databaseListKey } from "./use-database-list";

export function DatabaseSchemaSelect({
  reference,
  value,
  onChange,
}: {
  reference: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const schemas = useQuery({
    queryKey: databaseListKey(reference, "schemas", "", "", "", 0),
    queryFn: () => supabaseStudioDatabaseList<DbSchema>(reference, "schemas", {}),
  });
  const names = schemas.data?.items.map((schema) => schema.name) ?? [];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-8 w-44 text-xs" aria-label="Schema">
        <SelectValue placeholder="Schema" />
      </SelectTrigger>
      <SelectContent>
        {(names.includes(value) ? names : [value, ...names]).map((name) => (
          <SelectItem key={name} value={name} className="text-xs">
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
