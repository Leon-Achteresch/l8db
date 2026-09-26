import { CopyIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/clipboard";
import type { Json } from "@/lib/extensions/contracts";
import type { VaultStatus } from "./password-manager";
import { VaultField } from "./vault-field";

const REGIONS = [
  { id: "US", label: "USA" },
  { id: "EU", label: "Europa" },
  { id: "AU", label: "Australien" },
  { id: "CA", label: "Kanada" },
  { id: "JP", label: "Japan" },
  { id: "GOV", label: "US Government Cloud" },
];

export function KeeperLoginForm({
  status,
  busy,
  onLogin,
  onRefresh,
}: {
  status: VaultStatus;
  busy: boolean;
  onLogin: (input: Record<string, Json>) => void;
  onRefresh: () => void;
}) {
  const [region, setRegion] = useState("EU");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const commands = [
    `keeper shell --server ${region}`,
    `login ${email.trim() || "du@example.com"}`,
    "this-device register",
    "this-device persistent-login on",
    "this-device timeout 30d",
    "quit",
  ].join("\n");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onLogin({ server: region, email: email.trim(), password });
  };

  if (status.needs === "terminal")
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Keeper möchte dieses Gerät bestätigen oder fragt nach einem zweiten Faktor. Das geht nur
          interaktiv: Führe die Befehle einmalig im Terminal aus und prüfe danach erneut.
        </p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-xl bg-muted/60 p-3 pr-10 font-mono text-xs leading-relaxed select-text">
            {commands}
          </pre>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Befehle kopieren"
            className="absolute top-2 right-2"
            onClick={() => void copyText(commands).then(() => toast.success("Befehle kopiert"))}
          >
            <CopyIcon />
          </Button>
        </div>
        <Button size="sm" disabled={busy} onClick={onRefresh}>
          {busy && <Spinner />}
          Erneut prüfen
        </Button>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 @min-[40rem]:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Region</p>
          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger aria-label="Keeper-Region" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <VaultField
          label="E-Mail"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <VaultField
        label="Master-Passwort"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={busy || !email.trim() || !password}>
        {busy && <Spinner />}
        Anmelden
      </Button>
      <p className="text-xs text-muted-foreground">
        l8db richtet für dieses Gerät eine dauerhafte Keeper-Anmeldung ein. Das Master-Passwort wird
        nicht gespeichert.
      </p>
    </form>
  );
}
