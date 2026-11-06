import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function TeamGettingStarted() {
  const { ref } = useNewFeatureVisibility<HTMLOListElement>("onboarding.team-workflow");
  return (
    <ol
      ref={ref}
      className="list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground"
    >
      <li>
        Die IT verteilt die freigegebene App und Team-Verbindungen. Fehlt eine Verbindung, öffne
        Einstellungen → Allgemein → Team-Verbindungen und kontaktiere die IT.
      </li>
      <li>
        Melde dich mit deinem persönlichen Datenbankkonto an. Leserechte, Änderungsrechte und
        administrative Rechte vergibt die Datenbankadministration.
      </li>
      <li>
        Prüfe vor jeder Änderung Verbindung, Datenbank, Schema und Umgebung. Produktion bleibt
        zunächst schreibgeschützt.
      </li>
      <li>
        Prüfe Änderungen im Transaktionsbereich. Commit übernimmt sie, Rollback verwirft sie. DDL
        und nicht transaktionale Datenbanken können Änderungen sofort übernehmen.
      </li>
      <li>
        Nutze für Produktionsänderungen den freigegebenen Ablauf und eine geprüfte
        Wiederherstellung. Bei unklarem Ausgang nicht blind erneut ausführen.
      </li>
      <li>
        Teile keine Passwörter, Rohdaten oder vollständigen Verbindungsadressen in Tickets. Nutze
        KI, Exporte und Erweiterungen nur nach den Vorgaben deiner Organisation.
      </li>
    </ol>
  );
}
