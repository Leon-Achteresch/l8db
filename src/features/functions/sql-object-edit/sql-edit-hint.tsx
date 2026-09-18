export function SqlEditHint() {
  return (
    <div className="border-b bg-amber-500/5 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300">
      Entwurf lokal gespeichert. Änderungen sind noch nicht in der Datenbank. <b>Nur prüfen</b>{" "}
      kompiliert testweise und rollt zurück, <b>In Datenbank speichern</b> führt das SQL aus und
      ersetzt das Objekt dauerhaft.
    </div>
  );
}
