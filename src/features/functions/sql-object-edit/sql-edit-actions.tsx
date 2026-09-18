import { Database, Loader, ShieldCheck } from "lucide";
import { PencilIcon, UndoIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SqlObjectEdit } from "../use-sql-object-edit";

export function SqlEditActions({ edit }: { edit: SqlObjectEdit }) {
  const busy = edit.state.status === "checking" || edit.state.status === "applying";

  if (!edit.editing) {
    return (
      <Button variant="outline" size="xs" onClick={edit.start}>
        <PencilIcon data-icon="inline-start" />
        Bearbeiten
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="xs" onClick={edit.cancel} disabled={busy}>
        <UndoIcon data-icon="inline-start" />
        Entwurf verwerfen
      </Button>
      <Button
        variant="outline"
        size="xs"
        onClick={() => void edit.check()}
        disabled={busy}
        title="Kompiliert testweise und macht die Änderung sofort rückgängig — nichts wird gespeichert."
      >
        <MorphIcon
          icon={edit.state.status === "checking" ? Loader : ShieldCheck}
          data-icon="inline-start"
          className={cn(edit.state.status === "checking" && "animate-spin")}
        />
        Nur prüfen
      </Button>
      <Button
        variant="default"
        size="xs"
        onClick={() => void edit.apply()}
        disabled={busy}
        title="Führt das SQL wirklich aus — das Objekt existiert danach so in der Datenbank."
      >
        <MorphIcon
          icon={edit.state.status === "applying" ? Loader : Database}
          data-icon="inline-start"
          className={cn(edit.state.status === "applying" && "animate-spin")}
        />
        In Datenbank speichern
      </Button>
    </>
  );
}
