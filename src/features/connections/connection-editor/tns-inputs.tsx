import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { connectionError } from "@/lib/connection-url";
import { openTnsNames, oracleTnsNames } from "@/lib/db";
import { ConnectionField } from "../connection-field";

export function ConnectionTnsInputs({
  tns,
  setTns,
  tnsAlias,
  setTnsAlias,
  user,
  setUser,
  password,
  setPassword,
}: {
  tns: { path: string | null; aliases: string[] } | null;
  setTns: (value: { path: string | null; aliases: string[] }) => void;
  tnsAlias: string;
  setTnsAlias: (value: string) => void;
  user: string;
  setUser: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-1">
        <Label htmlFor="connection-tns" className="text-xs text-muted-foreground">
          TNS-Alias
        </Label>
        <div className="flex items-end gap-2">
          <Select value={tnsAlias} onValueChange={setTnsAlias}>
            <SelectTrigger id="connection-tns" className="w-full">
              <SelectValue
                placeholder={tns?.aliases.length ? "Alias wählen" : "Keine Aliase gefunden"}
              />
            </SelectTrigger>
            <SelectContent position="popper" searchable>
              {(tns?.aliases.includes(tnsAlias) || !tnsAlias
                ? (tns?.aliases ?? [])
                : [tnsAlias, ...(tns?.aliases ?? [])]
              ).map((alias) => (
                <SelectItem key={alias} value={alias}>
                  {alias}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            aria-label="tnsnames.ora neu laden"
            onClick={() => void oracleTnsNames().then(setTns)}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => openTnsNames().catch((error) => toast.error(connectionError(error)))}
          >
            TNSNames Editor
          </Button>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {tns?.path ??
            "Keine tnsnames.ora gefunden: TNS_ADMIN setzen oder unter <Instant Client>/network/admin ablegen."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ConnectionField
          id="connection-tns-user"
          label="Benutzer"
          value={user}
          onChange={(event) => setUser(event.target.value)}
        />
        <ConnectionField
          id="connection-tns-password"
          label="Passwort"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
    </div>
  );
}
