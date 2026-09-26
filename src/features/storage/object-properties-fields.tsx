import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ObjectProperties } from "@/lib/db";
import { KeyValueEditor } from "./key-value-editor";

const STORAGE_CLASSES = [
  "STANDARD",
  "REDUCED_REDUNDANCY",
  "STANDARD_IA",
  "ONEZONE_IA",
  "INTELLIGENT_TIERING",
  "GLACIER_IR",
  "GLACIER",
  "DEEP_ARCHIVE",
];

const TEXT_FIELDS: { key: keyof ObjectProperties; label: string; placeholder: string }[] = [
  { key: "content_type", label: "Content-Type", placeholder: "automatisch" },
  { key: "cache_control", label: "Cache-Control", placeholder: "max-age=3600" },
  {
    key: "content_disposition",
    label: "Content-Disposition",
    placeholder: 'attachment; filename="x"',
  },
  { key: "content_encoding", label: "Content-Encoding", placeholder: "gzip" },
  { key: "content_language", label: "Content-Language", placeholder: "de-DE" },
  { key: "expires", label: "Expires", placeholder: "Wed, 21 Oct 2026 07:28:00 GMT" },
];

export function ObjectPropertiesFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ObjectProperties;
  onChange: (value: ObjectProperties) => void;
  disabled?: boolean;
}) {
  const metadata = Object.entries(value.metadata ?? {}).map(([key, v]) => ({ key, value: v }));
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        {TEXT_FIELDS.map((field) => (
          <div key={field.key} className="grid gap-1">
            <Label htmlFor={`prop-${field.key}`} className="text-xs text-muted-foreground">
              {field.label}
            </Label>
            <Input
              id={`prop-${field.key}`}
              className="h-8 text-xs"
              placeholder={field.placeholder}
              disabled={disabled}
              value={(value[field.key] as string | null | undefined) ?? ""}
              onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
            />
          </div>
        ))}
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Speicherklasse</Label>
          <Select
            value={value.storage_class || "default"}
            disabled={disabled}
            onValueChange={(next) =>
              onChange({ ...value, storage_class: next === "default" ? null : next })
            }
          >
            <SelectTrigger className="h-8 w-full text-xs" aria-label="Speicherklasse">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="default">Standard des Anbieters</SelectItem>
              {STORAGE_CLASSES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Verschlüsselung</Label>
          <Select
            value={value.server_side_encryption || "none"}
            disabled={disabled}
            onValueChange={(next) =>
              onChange({ ...value, server_side_encryption: next === "none" ? null : next })
            }
          >
            <SelectTrigger className="h-8 w-full text-xs" aria-label="Verschlüsselung">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="none">Bucket-Standard</SelectItem>
              <SelectItem value="AES256">SSE-S3 (AES256)</SelectItem>
              <SelectItem value="aws:kms">SSE-KMS</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.server_side_encryption === "aws:kms" && (
          <div className="col-span-2 grid gap-1">
            <Label htmlFor="prop-kms" className="text-xs text-muted-foreground">
              KMS-Schlüssel
            </Label>
            <Input
              id="prop-kms"
              className="h-8 text-xs"
              disabled={disabled}
              value={value.kms_key_id ?? ""}
              onChange={(event) => onChange({ ...value, kms_key_id: event.target.value })}
            />
          </div>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Benutzer-Metadaten (x-amz-meta-*)</Label>
        <KeyValueEditor
          items={metadata}
          disabled={disabled}
          addLabel="Metadatum hinzufügen"
          onChange={(items) =>
            onChange({
              ...value,
              metadata: Object.fromEntries(items.map((item) => [item.key, item.value])),
            })
          }
        />
      </div>
    </div>
  );
}
