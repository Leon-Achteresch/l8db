import { GitCompare, Layers, Loader, Lock } from "lucide";
import { DatabaseIcon, GitCompareIcon, LayersIcon, LoaderIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";

import { ProviderLogo } from "@/components/provider-logo";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { useCompareSidePicker } from "@/features/compare/compare-side-picker/use-compare-side-picker";
import {
  COMPARE_OBJECT_LABELS,
  type CompareObjectType,
  type CompareSideSelection,
} from "@/lib/compare-types";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { cn } from "@/lib/utils";

interface CompareSidePickerProps {
  title: string;
  value: CompareSideSelection;
  onChange: (value: CompareSideSelection) => void;
  lockConnection?: SavedConnection | null;
  hideObjectType?: boolean;
  preferredObjectName?: string | null;
}

export function CompareSidePicker({
  title,
  value,
  onChange,
  lockConnection,
  hideObjectType,
  preferredObjectName,
}: CompareSidePickerProps) {
  const {
    databases,
    schemas,
    objects,
    loadError,
    loadingSchemas,
    loadingObjects,
    usable,
    connection,
    capabilities,
    availableTypes,
    usesOid,
    emit,
    handleConnection,
  } = useCompareSidePicker(value, onChange, lockConnection, preferredObjectName);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <MorphIcon
          icon={lockConnection ? Lock : GitCompare}
          className={cn("size-3.5 shrink-0", lockConnection ? "text-emerald-500" : "text-sky-500")}
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {lockConnection && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <ProviderLogo
              providerId={providerFor(lockConnection).id}
              kind={lockConnection.kind}
              className="size-3.5"
            />
            <span className="truncate">{lockConnection.name}</span>
          </span>
        )}
      </div>
      {loadError && <span className="text-xs text-destructive">{loadError}</span>}

      {!lockConnection && (
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-1.5 text-xs">
            <GitCompareIcon className="size-3.5 text-muted-foreground" />
            Verbindung
          </Label>
          <Select value={value.connectionId ?? ""} onValueChange={handleConnection}>
            <SelectTrigger className="h-8 w-full min-w-0 text-xs">
              <SelectValue placeholder="Verbindung wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {usable.map((item) => (
                <SelectItem key={item.id} value={item.id} className="text-xs">
                  <ProviderLogo
                    providerId={providerFor(item).id}
                    kind={item.kind}
                    className="size-3.5"
                  />
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {capabilities.databases && (
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-1.5 text-xs">
            <DatabaseIcon className="size-3.5 text-muted-foreground" />
            Datenbank
          </Label>
          <Select
            value={value.database ?? ""}
            onValueChange={(database) =>
              emit({ ...value, database, schema: null, objectName: null, objectOid: null })
            }
            disabled={!connection || databases.length === 0}
          >
            <SelectTrigger className="h-8 w-full min-w-0 text-xs">
              <SelectValue placeholder="Datenbank wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {databases.map((database) => (
                <SelectItem key={database} value={database} className="text-xs">
                  <DatabaseIcon className="size-3.5 text-muted-foreground" />
                  {database}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label className="flex items-center gap-1.5 text-xs">
          <MorphIcon
            icon={loadingSchemas ? Loader : Layers}
            className={cn(
              "size-3.5",
              loadingSchemas ? "animate-spin text-muted-foreground" : "text-muted-foreground",
            )}
          />
          Schema
        </Label>
        <Select
          value={value.schema ?? ""}
          onValueChange={(schema) => emit({ ...value, schema, objectName: null, objectOid: null })}
          disabled={!connection || loadingSchemas || schemas.length === 0}
        >
          <SelectTrigger className="h-8 w-full min-w-0 text-xs disabled:opacity-100">
            {loadingSchemas && (
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
            )}
            <SelectValue placeholder={loadingSchemas ? "Lädt…" : "Schema wählen"} />
          </SelectTrigger>
          <SelectContent searchable>
            {schemas.map((schema) => (
              <SelectItem key={schema} value={schema} className="text-xs">
                <LayersIcon className="size-3.5 text-muted-foreground" />
                {schema}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!hideObjectType && (
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-1.5 text-xs">
            <CompareObjectIcon type={value.objectType} />
            Objekttyp
          </Label>
          <Select
            value={value.objectType}
            onValueChange={(objectType) =>
              emit({
                ...value,
                objectType: objectType as CompareObjectType,
                objectName: null,
                objectOid: null,
              })
            }
            disabled={availableTypes.length < 2}
          >
            <SelectTrigger className="h-8 w-full min-w-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableTypes.map((type) => (
                <SelectItem key={type} value={type} className="text-xs">
                  <CompareObjectIcon type={type} />
                  {COMPARE_OBJECT_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label className="flex items-center gap-1.5 text-xs">
          {loadingObjects ? (
            <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <CompareObjectIcon type={value.objectType} />
          )}
          Objekt
        </Label>
        <Select
          value={usesOid ? (value.objectOid ?? "") : (value.objectName ?? "")}
          onValueChange={(picked) => {
            if (usesOid) {
              const match = objects.find((item) => item.oid === picked);
              emit({
                ...value,
                objectOid: picked,
                objectName: match?.name ?? null,
              });
              return;
            }
            emit({ ...value, objectName: picked, objectOid: null });
          }}
          disabled={!value.schema || loadingObjects || objects.length === 0}
        >
          <SelectTrigger className="h-8 w-full min-w-0 text-xs disabled:opacity-100">
            {loadingObjects && (
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
            )}
            <SelectValue placeholder={loadingObjects ? "Lädt…" : "Objekt wählen"} />
          </SelectTrigger>
          <SelectContent searchable>
            {objects.map((item) => (
              <SelectItem
                key={item.oid ?? item.name}
                value={usesOid ? (item.oid ?? item.name) : item.name}
                className="text-xs"
              >
                <CompareObjectIcon type={value.objectType} />
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
