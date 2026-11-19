export function SqlEditHint() {
  return (
    <div className="border-b bg-warning/5 px-4 py-1.5 text-xs text-warning">
      Entwurf lokal gespeichert. Änderungen sind noch nicht in der Datenbank. <b>Nur prüfen</b>{" "}
      kompiliert testweise und rollt zurück, <b>In Datenbank speichern</b> führt das SQL aus und
      ersetzt das Objekt dauerhaft.
    </div>
  );
}
