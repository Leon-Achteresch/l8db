import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { IndexRoles } from "@/lib/db";

export const INDEX_ROLE_PREVIEW_COLUMNS = 8;

export function IndexRoleDetails({ roles, definition }: { roles: IndexRoles; definition: string }) {
  const [expanded, setExpanded] = useState(false);
  const included = expanded ? roles.included : roles.included.slice(0, INDEX_ROLE_PREVIEW_COLUMNS);
  const other = expanded ? roles.other : roles.other.slice(0, INDEX_ROLE_PREVIEW_COLUMNS);
  const hidden = roles.included.length - included.length + roles.other.length - other.length;
  const chip = "rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground";
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-2xs text-muted-foreground">Schlüssel</span>
        {roles.keys.length === 0 && (
          <span className="text-2xs text-muted-foreground">nicht eingeordnet</span>
        )}
        {roles.keys.map((key) => (
          <span
            key={key.position}
            data-index-column="key"
            className={chip}
            title={key.descending === null ? "Sortierrichtung unbekannt" : undefined}
          >
            {key.position}. {key.name}{" "}
            {key.descending === null ? "?" : key.descending ? "DESC" : "ASC"}
          </span>
        ))}
      </div>
      {roles.included.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-2xs text-muted-foreground">
            INCLUDE ({roles.included.length})
          </span>
          {included.map((name) => (
            <span key={name} data-index-column="include" className={chip}>
              {name}
            </span>
          ))}
        </div>
      )}
      {roles.other.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-2xs text-muted-foreground">
            Sonstige Indexspalten ({roles.other.length})
          </span>
          {other.map((name) => (
            <span key={name} data-index-column="other" className={chip}>
              {name}
            </span>
          ))}
        </div>
      )}
      {(hidden > 0 || expanded) && (
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Weniger Spalten" : `${hidden} weitere Spalten anzeigen`}
        </Button>
      )}
      <p className="font-mono text-2xs break-all text-muted-foreground">
        {roles.filter.state === "known"
          ? `Filter: ${roles.filter.predicate}`
          : roles.filter.state === "none"
            ? "Ohne Filter"
            : roles.filter.state === "unavailable"
              ? "Filter vorhanden · Definition nicht verfügbar"
              : "Filterstatus unbekannt"}
      </p>
      {roles.definition_status === "reconstructed" ? (
        <>
          <p className="text-2xs text-muted-foreground">Rekonstruierte Definition</p>
          <p className="font-mono text-2xs text-muted-foreground break-all">{definition}</p>
        </>
      ) : (
        <p className="text-2xs text-muted-foreground">Definition nicht rekonstruiert</p>
      )}
    </div>
  );
}
