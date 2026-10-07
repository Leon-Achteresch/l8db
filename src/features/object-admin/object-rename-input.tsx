import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection, useReadOnlyConnection } from "@/lib/connections";
import { executeObjectDdl, type ObjectAdminType } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { objectRenameIssue, renameObjectTab } from "@/lib/object-rename";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

export function ObjectRenameInput({
  schema,
  name,
  objectType,
  onClose,
  onRenamed,
}: {
  schema: string;
  name: string;
  objectType: ObjectAdminType;
  onClose: () => void;
  onRenamed?: (name: string) => void;
}) {
  const connection = useActiveConnection();
  const readOnly = useReadOnlyConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const feature = useNewFeatureVisibility<HTMLFormElement>("sidebar.rename-inline");
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = async () => {
    if (pending || !connection || readOnly) return;
    if (value.trim() === name) {
      onClose();
      return;
    }
    const issue = objectRenameIssue(name, value);
    if (issue) {
      setError(issue);
      return;
    }
    setPending(true);
    setError(null);
    const next = value.trim();
    try {
      await executeObjectDdl(
        connection.kind,
        effectiveConnectionString(connection),
        {
          schema,
          name,
          object_type: objectType,
          action: "rename",
          cascade: false,
          new_name: next,
        },
        database ?? undefined,
      );
      useTableTabs.setState((state) => {
        const update = (tabs: typeof state.tabs) =>
          tabs.map((tab) =>
            tab.connectionId && tab.connectionId !== connection.id
              ? tab
              : renameObjectTab(tab, schema, name, next, objectType),
          );
        return {
          tabs: update(state.tabs),
          tabsByConnection: {
            ...state.tabsByConnection,
            [connection.id]: update(state.tabsByConnection[connection.id] ?? state.tabs),
          },
        };
      });
      onRenamed?.(next);
      onClose();
      await Promise.all(
        ["tables", "views", "matviews", "columns", "columns-detailed", "rows", "count"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (reason) {
      setError(String(reason));
      input.current?.focus();
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      ref={feature.ref}
      className="min-w-0 space-y-1 px-1 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!pending) onClose();
        }
        if (event.key === "Enter") event.stopPropagation();
      }}
    >
      <div className="flex items-center gap-1">
        <Input
          ref={input}
          aria-label={`${name} umbenennen`}
          aria-describedby={error ? id : undefined}
          aria-invalid={Boolean(error)}
          value={value}
          disabled={pending || readOnly}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          className="h-7 min-w-0 font-mono text-xs"
        />
        {feature.isNew && <NewBadge />}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Button
          type="submit"
          variant="ghost"
          className="h-5 gap-1 px-1 text-[10px]"
          disabled={pending || Boolean(objectRenameIssue(name, value))}
          aria-label="Namen übernehmen"
        >
          {pending ? <Spinner className="size-3" /> : <CheckIcon className="size-3" />}
          <Kbd>↵</Kbd> übernehmen
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-5 gap-1 px-1 text-[10px]"
          disabled={pending}
          onClick={onClose}
          aria-label="Umbenennen abbrechen"
        >
          <XIcon className="size-3" />
          <Kbd>esc</Kbd> abbrechen
        </Button>
      </div>
      {error && (
        <p id={id} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
