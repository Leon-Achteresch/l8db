const AUTH_ERROR_PATTERN =
  /password authentication|28P01|Access denied|Login failed|Authentication failed|NOAUTH|WRONGPASS|invalid password|ORA-01017|ORA-01005|Oracle-Passwort fehlt/i;

const INTERRUPTED_QUERY_PATTERN =
  /Query-Timeout|SQLSTATE (57014|55P03)|abgebrochen|Abbruch|canceling statement|lock timeout|Lock wait timeout|ORA-01013/i;

export const AUTH_FAILED_MESSAGE =
  "Anmeldung fehlgeschlagen. Prüfe Benutzer und Datenbankpasswort.";

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

export function isAuthFailure(error: unknown): boolean {
  const message = errorText(error);
  return AUTH_ERROR_PATTERN.test(message) || message.includes(AUTH_FAILED_MESSAGE);
}

export function isInterruptedQuery(error: unknown): boolean {
  return INTERRUPTED_QUERY_PATTERN.test(errorText(error));
}

export function queryErrorMessage(error: unknown): string | null {
  if (isAuthFailure(error)) return null;
  return connectionError(error);
}

export function connectionError(error: unknown): string {
  const message = errorText(error)
    .replace(/(password|pwd)(\s*=\s*)("[^"]*"|'[^']*'|[^;\s]*)/gi, "$1$2***")
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[Verbindungs-URL]");
  if (/__TAURI|invoke|undefined.*(properties|function)/i.test(message))
    return "Zum Testen und Verbinden öffne l8db als Desktop-App.";
  if (AUTH_ERROR_PATTERN.test(message)) return AUTH_FAILED_MESSAGE;
  if (
    /Oracle-Host \S+ (antwortet nicht|ist nicht erreichbar|kann nicht aufgelöst werden)/.test(
      message,
    )
  )
    return message.replace(/^Error:\s*/, "");
  if (/ORA-12514/i.test(message))
    return "Der Service-Name ist dem Listener unbekannt (ORA-12514). Prüfe Service-Name und Listener.";
  if (/ORA-12541/i.test(message))
    return "Kein Oracle-Listener auf Host und Port (ORA-12541). Prüfe Host, Port und ob die Datenbank läuft.";
  if (/ORA-12545/i.test(message))
    return "Der Ziel-Host existiert nicht (ORA-12545). Prüfe Hostnamen, DNS und VPN.";
  if (/^MongoDB:\s*/i.test(message)) {
    const detail = message.replace(/^MongoDB:\s*/i, "");
    if (/server selection|no available servers|timeout|timed out|dns|resolve/i.test(detail))
      return `MongoDB-Serverauswahl fehlgeschlagen. Prüfe Atlas-IP-Allowlist, DNS/SRV und Firewall. Details: ${detail}`;
    return detail;
  }
  if (/certificate|tls|ssl/i.test(message))
    return "TLS-Verbindung fehlgeschlagen. Prüfe SSL-Modus, Servername und das Zertifikat im System-Zertifikatsspeicher.";
  if (/timeout|timed out/i.test(message))
    return "Der Server antwortet nicht rechtzeitig. Prüfe Endpunkt, Firewall und ob die Datenbank läuft.";
  if (/refused|resolve|dns|No such host/i.test(message))
    return "Der Server ist nicht erreichbar. Prüfe Host, Port und Netzwerkzugang.";
  return message.replace(/^Error:\s*/, "");
}
