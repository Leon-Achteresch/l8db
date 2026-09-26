import { CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyText } from "@/lib/clipboard";
import type { VAULT_PROVIDERS } from "./password-manager";
import { VaultField } from "./vault-field";

const KINDS = [
  { scheme: "postgres", label: "PostgreSQL", port: "5432" },
  { scheme: "mysql", label: "MySQL / MariaDB", port: "3306" },
  { scheme: "sqlserver", label: "SQL Server", port: "1433" },
  { scheme: "oracle", label: "Oracle", port: "1521" },
  { scheme: "mongodb", label: "MongoDB", port: "27017" },
  { scheme: "redis", label: "Redis", port: "6379" },
  { scheme: "clickhouse", label: "ClickHouse", port: "8123" },
];

export function VaultManualEntry({ provider }: { provider: (typeof VAULT_PROVIDERS)[number] }) {
  const [scheme, setScheme] = useState("postgres");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState("");
  const kind = KINDS.find((entry) => entry.scheme === scheme) ?? KINDS[0];
  const address = `${kind.scheme}://${host.trim() || "server.firma.local"}:${port.trim() || kind.port}${database.trim() ? `/${encodeURIComponent(database.trim())}` : ""}`;

  return (
    <div className="space-y-3 text-xs">
      <ol className="list-decimal space-y-1.5 pl-4 text-muted-foreground marker:text-foreground">
        <li>
          Neuen Eintrag vom Typ <span className="text-foreground">{provider.entry}</span>{" "}
          {provider.team} anlegen.
        </li>
        <li>
          Name mit <span className="font-mono text-foreground">l8db:</span> beginnen, z. B.{" "}
          <span className="text-foreground">„l8db: Buchhaltung“</span>. Der Rest wird zum Namen der
          Verbindung.
        </li>
        <li>Benutzername und Passwort des Datenbank-Kontos eintragen.</li>
        <li>
          Unter <span className="text-foreground">{provider.website}</span> die Adresse der
          Datenbank eintragen. Die kannst du hier zusammenstellen:
        </li>
      </ol>
      <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
        <div className="grid gap-3 @min-[40rem]:grid-cols-[11rem_minmax(0,1fr)_6rem]">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Datenbank</p>
            <Select value={scheme} onValueChange={setScheme}>
              <SelectTrigger aria-label="Datenbanktyp" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((entry) => (
                  <SelectItem key={entry.scheme} value={entry.scheme}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <VaultField
            label="Server"
            placeholder="server.firma.local"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
          <VaultField
            label="Port"
            inputMode="numeric"
            placeholder={kind.port}
            value={port}
            onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
          />
        </div>
        <VaultField
          label="Datenbankname (optional)"
          placeholder="z. B. buchhaltung"
          value={database}
          onChange={(event) => setDatabase(event.target.value)}
        />
        <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono select-text">{address}</code>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Adresse kopieren"
            onClick={() => void copyText(address).then(() => toast.success("Adresse kopiert"))}
          >
            <CopyIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
