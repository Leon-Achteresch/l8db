import type { TeamSetupScene } from "./team-setup-video";

const ENTRA_NAV = [
  "Startseite",
  "Benutzer",
  "Gruppen",
  "Unternehmensanwendungen",
  "App-Registrierungen",
];
const SP_ADMIN_NAV = ["Startseite", "Websites", "Aktive Websites", "Richtlinien", "Einstellungen"];
const SP_NAV = ["Startseite", "Dokumente", "Seiten", "Websiteinhalte"];
const INTUNE_NAV = ["Startseite", "Geräte", "Apps", "Endpunktsicherheit", "Gruppen"];
const LOGIN = "login.microsoftonline.com";
const SITE = "firma.sharepoint.com/sites/l8db";

export const TEAM_SETUP_SCENES: Record<string, TeamSetupScene[]> = {
  consent: [
    {
      app: "l8db",
      url: "l8db › Einstellungen › Team-Verbindungen",
      title: "Team-Verbindungen · Für die IT",
      rows: ["Einmalig: l8db für die ganze Organisation in Microsoft freigeben."],
      action: "Für die Organisation freigeben",
      caption: "In l8db „Für die Organisation freigeben“ wählen. Der Browser öffnet Microsoft.",
    },
    {
      app: "Microsoft",
      url: LOGIN,
      title: "Anmelden",
      fields: [["E-Mail, Telefon oder Skype", "admin@firma.de"]],
      action: "Weiter",
      caption:
        "Mit einem Konto mit der Rolle Globale Administration oder Cloudanwendungsadministration anmelden.",
    },
    {
      app: "Microsoft",
      url: LOGIN,
      title: "Angeforderte Berechtigungen · l8db",
      rows: [
        "Anmelden und Benutzerprofil lesen",
        "Elemente in allen Websitesammlungen lesen",
        "Zugriff auf erteilte Daten beibehalten",
      ],
      action: "Akzeptieren",
      caption:
        "Berechtigungen prüfen und „Akzeptieren“. Die Zustimmung gilt für alle im Unternehmen.",
    },
    {
      app: "Microsoft Entra Admin Center",
      url: "entra.microsoft.com",
      nav: ENTRA_NAV,
      active: "Unternehmensanwendungen",
      title: "l8db | Berechtigungen",
      rows: [
        "Microsoft Graph · openid · Zustimmung erteilt",
        "Microsoft Graph · Sites.Read.All · Zustimmung erteilt",
      ],
      action: "Administratorzustimmung für Firma erteilen",
      caption:
        "Kontrolle oder Alternative: Entra Admin Center › Unternehmensanwendungen › l8db › Berechtigungen.",
    },
  ],
  site: [
    {
      app: "SharePoint Admin Center",
      url: "firma-admin.sharepoint.com",
      nav: SP_ADMIN_NAV,
      active: "Aktive Websites",
      title: "Aktive Websites",
      rows: ["Intranet · Kommunikationswebsite", "Vertrieb · Teamwebsite"],
      action: "+ Erstellen",
      caption: "SharePoint Admin Center › Websites › Aktive Websites › „Erstellen“.",
    },
    {
      app: "SharePoint Admin Center",
      url: "firma-admin.sharepoint.com",
      nav: SP_ADMIN_NAV,
      active: "Aktive Websites",
      title: "Website erstellen",
      rows: [
        "Teamwebsite · Mitglieder dürfen bearbeiten",
        "Kommunikationswebsite · für viele Leser",
      ],
      action: "Kommunikationswebsite",
      caption:
        "„Kommunikationswebsite“ wählen, nicht Teamwebsite: Dort dürfen alle Mitglieder Dateien bearbeiten.",
    },
    {
      app: "SharePoint Admin Center",
      url: "firma-admin.sharepoint.com",
      nav: SP_ADMIN_NAV,
      active: "Aktive Websites",
      title: "Kommunikationswebsite",
      fields: [
        ["Websitename", "l8db"],
        ["Websiteadresse", "…/sites/l8db"],
        ["Websitebesitzer", "IT-Admins"],
      ],
      action: "Fertig stellen",
      caption: "Name „l8db“, als Besitzer nur die IT eintragen.",
    },
    {
      app: "SharePoint · l8db",
      url: SITE,
      nav: SP_NAV,
      active: "Dokumente",
      title: "Dokumente",
      rows: ["Ordner · Alle", "Ordner · Vertrieb", "Ordner · Finanzen"],
      action: "+ Neu › Ordner",
      caption:
        "In „Dokumente“ pro Zielgruppe einen Ordner anlegen, zum Beispiel Alle, Vertrieb, Finanzen.",
    },
  ],
  access: [
    {
      app: "SharePoint · l8db",
      url: `${SITE}/Freigegebene Dokumente`,
      nav: SP_NAV,
      active: "Dokumente",
      title: "Dokumente",
      rows: ["Alle", "Vertrieb · ausgewählt", "Finanzen"],
      action: "… › Zugriff verwalten",
      caption: "Ordner auswählen und im Menü „…“ auf „Zugriff verwalten“ klicken.",
    },
    {
      app: "SharePoint · l8db",
      url: `${SITE}/Freigegebene Dokumente/Vertrieb`,
      nav: SP_NAV,
      active: "Dokumente",
      title: "Zugriff verwalten · Vertrieb",
      rows: ["Besitzer von l8db · Vollzugriff", "IT-Admins · Kann bearbeiten"],
      action: "Zugriff gewähren",
      caption: "„Zugriff gewähren“ öffnet den Freigabedialog für diesen Ordner.",
    },
    {
      app: "SharePoint · l8db",
      url: `${SITE}/Freigegebene Dokumente/Vertrieb`,
      nav: SP_NAV,
      active: "Dokumente",
      title: "Zugriff gewähren",
      fields: [
        ["Name, Gruppe oder E-Mail", "Vertrieb (Entra-Gruppe)"],
        ["Berechtigung", "Kann anzeigen"],
      ],
      action: "Gewähren",
      caption:
        "Die passende Entra-Gruppe eintragen, „Kann anzeigen“ wählen. Bearbeiten darf nur die IT.",
    },
    {
      app: "SharePoint · l8db",
      url: `${SITE}/Freigegebene Dokumente/Vertrieb`,
      nav: SP_NAV,
      active: "Dokumente",
      title: "Zugriff verwalten · Vertrieb",
      rows: [
        "Besitzer von l8db · Vollzugriff",
        "IT-Admins · Kann bearbeiten",
        "Vertrieb · Kann anzeigen",
      ],
      action: "Zugriff prüfen",
      caption:
        "Kontrolle pro Person über „Zugriff prüfen“. Wer in mehreren Gruppen ist, sieht alles davon.",
    },
  ],
  connections: [
    {
      app: "l8db",
      url: "l8db › Team-Einrichtung › Verbindungen ablegen",
      title: "Beispiel-JSON",
      rows: [
        "erp-produktion · mssql · ERP Produktion",
        "reporting · postgres · Reporting",
        "lager-test · mysql · Lager (Test)",
      ],
      action: "Beispiel herunterladen",
      caption:
        "Beispieldatei herunterladen, Hosts und Namen anpassen. Passwörter gehören nie hinein.",
    },
    {
      app: "SharePoint · l8db",
      url: `${SITE}/Freigegebene Dokumente/Vertrieb`,
      nav: SP_NAV,
      active: "Dokumente",
      title: "Dokumente › Vertrieb",
      rows: ["Dieser Ordner ist leer"],
      action: "Hochladen › Dateien",
      caption:
        "Im Ordner der Zielgruppe „Hochladen › Dateien“ wählen und die JSON-Datei hochladen.",
    },
    {
      app: "SharePoint · l8db",
      url: `${SITE}/Freigegebene Dokumente/Vertrieb`,
      nav: SP_NAV,
      active: "Dokumente",
      title: "Dokumente › Vertrieb",
      rows: ["l8db-verbindungen.json · Gerade eben · IT-Admin"],
      caption:
        "Fertig: Alle mit Leserecht auf den Ordner erhalten die Verbindungen beim nächsten Abgleich.",
    },
    {
      app: "l8db",
      url: "l8db › Verbindungen",
      title: "ERP Produktion · Menü",
      rows: ["Verbinden", "Bearbeiten", "Duplizieren"],
      action: "Für Team freigeben…",
      caption:
        "Ohne JSON: Verbindung in l8db anlegen, testen, „Für Team freigeben…“ wählen. l8db lädt sie ohne Passwort hoch.",
    },
  ],
  policy: [
    {
      app: "Microsoft Intune Admin Center",
      url: "intune.microsoft.com",
      nav: INTUNE_NAV,
      active: "Geräte",
      title: "Geräte | Skripts und Wartungen › Plattformskripts",
      rows: ["Noch keine Skripts"],
      action: "+ Hinzufügen › Windows 10 und höher",
      caption: "Intune › Geräte › Skripts und Wartungen › Plattformskripts › „Hinzufügen“.",
    },
    {
      app: "Microsoft Intune Admin Center",
      url: "intune.microsoft.com",
      nav: INTUNE_NAV,
      active: "Geräte",
      title: "Skript hinzufügen · Skripteinstellungen",
      fields: [
        ["Skriptspeicherort", "l8db-richtlinie.ps1"],
        ["Anmeldeinformationen des Benutzers verwenden", "Nein"],
        ["In 64-Bit-PowerShell-Host ausführen", "Ja"],
      ],
      action: "Weiter",
      caption:
        "Das heruntergeladene Skript hochladen. Anmeldeinformationen des Benutzers: Nein, 64-Bit-Host: Ja.",
    },
    {
      app: "Microsoft Intune Admin Center",
      url: "intune.microsoft.com",
      nav: INTUNE_NAV,
      active: "Geräte",
      title: "Skript hinzufügen · Zuweisungen",
      fields: [["Eingeschlossene Gruppen", "Alle Geräte mit l8db"]],
      action: "Hinzufügen",
      caption:
        "Gerätegruppe zuweisen und speichern. Ohne Intune: ADMX-Vorlage per Gruppenrichtlinie.",
    },
  ],
  test: [
    {
      app: "l8db",
      url: "l8db › Start",
      title: "Mit Firmenkonto anmelden",
      rows: ["Deine Organisation stellt Datenbankverbindungen über Microsoft 365 bereit."],
      action: "Mit Microsoft anmelden",
      caption:
        "Mit Richtlinie fragt l8db beim Start automatisch, sonst unter Einstellungen › Team-Verbindungen.",
    },
    {
      app: "Microsoft",
      url: LOGIN,
      title: "Konto auswählen",
      rows: ["Max Muster · max@firma.de · Angemeldet"],
      action: "Max Muster",
      caption: "Auf Rechnern in Entra meist ohne Passwort: Konto wählen, fertig.",
    },
    {
      app: "l8db",
      url: "l8db › Verbindungen",
      title: "Verbindungen",
      rows: ["ERP Produktion · Team", "Reporting · Team", "Lager (Test) · Team"],
      action: "Verbinden",
      caption:
        "Die Verbindungen erscheinen. Beim ersten Verbinden fragt l8db nach Datenbank-Benutzer und Passwort.",
    },
  ],
};
