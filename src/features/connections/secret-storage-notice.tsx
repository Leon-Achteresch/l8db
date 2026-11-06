import { useSecretStorageStatus } from "@/lib/secret-storage-status";

export function SecretStorageNotice() {
  const count = useSecretStorageStatus((state) => state.failedAccounts.length);
  if (!count) return null;
  return (
    <p
      role="alert"
      className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs"
    >
      Der Schlüsselbund ist nicht verfügbar. {count === 128 ? "Mindestens " : ""}
      {count} Zugangsdaten sind nur für diese Sitzung gespeichert und gehen beim Beenden verloren.
      Entsperre den Schlüsselbund und speichere die Verbindung erneut. Es werden keine Zugangsdaten
      im Klartext gespeichert.
    </p>
  );
}
