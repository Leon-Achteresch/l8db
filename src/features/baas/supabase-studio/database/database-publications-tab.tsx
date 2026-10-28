import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DbPublication } from "@/lib/db/supabase-studio-database";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabasePublicationTables } from "./database-publication-tables";
import { DatabaseTable } from "./database-table";
import { useDatabaseAction } from "./use-database-action";
import { useDatabaseList } from "./use-database-list";

const OPERATIONS = ["insert", "update", "delete", "truncate"] as const;

export function DatabasePublicationsTab({ reference }: { reference: string }) {
  const list = useDatabaseList<DbPublication>(reference, "publications");
  const action = useDatabaseAction(reference);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <DatabaseListFrame list={list} empty="Keine Publikationen vorhanden.">
      {(items) => (
        <DatabaseTable
          headers={[
            "Name",
            "Besitzer",
            ...OPERATIONS.map((operation) => operation.toUpperCase()),
            "Tabellen",
          ]}
        >
          {items.map((publication) => (
            <Fragment key={publication.oid}>
              <tr>
                <td className="font-medium">{publication.name}</td>
                <td>{publication.owner}</td>
                {OPERATIONS.map((operation) => (
                  <td key={operation}>
                    <Checkbox
                      checked={publication[`publish_${operation}`]}
                      disabled={action.isPending}
                      aria-label={`${operation.toUpperCase()} für ${publication.name} veröffentlichen`}
                      onCheckedChange={(value) =>
                        action.mutate({
                          action: "set_publication_actions",
                          publication: publication.name,
                          insert: publication.publish_insert,
                          update: publication.publish_update,
                          delete: publication.publish_delete,
                          truncate: publication.publish_truncate,
                          [operation]: value === true,
                        })
                      }
                    />
                  </td>
                ))}
                <td>
                  {publication.all_tables ? (
                    <Badge variant="secondary">Alle Tabellen</Badge>
                  ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setOpen(open === publication.name ? null : publication.name)}
                    >
                      {open === publication.name ? <ChevronDown /> : <ChevronRight />}
                      {publication.table_count}
                    </Button>
                  )}
                </td>
              </tr>
              {open === publication.name && (
                <tr>
                  <td colSpan={7} className="bg-muted/20">
                    <DatabasePublicationTables
                      reference={reference}
                      publication={publication.name}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </DatabaseTable>
      )}
    </DatabaseListFrame>
  );
}
