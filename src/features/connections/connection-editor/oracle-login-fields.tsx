import { NewBadge } from "@/components/new-badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { searchParam, withSearchParam } from "@/lib/connection-url";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { ConnectionField } from "../connection-field";

const PRIVILEGES = ["normal", "sysdba", "sysoper", "sysbackup", "sysdg", "syskm", "sysasm"];

export function ConnectionOracleLoginFields({
  extraParams,
  setExtraParams,
}: {
  extraParams: string;
  setExtraParams: (value: string) => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("connections.oracle-login");
  const param = (key: string) => searchParam(extraParams, key);
  const setParam = (key: string, value: string) =>
    setExtraParams(withSearchParam(extraParams, key, value));
  const tcps = param("protocol").toLowerCase() === "tcps" || ["1", "true"].includes(param("ssl"));
  const privilege = PRIVILEGES.includes(param("privilege").toLowerCase())
    ? param("privilege").toLowerCase()
    : "normal";
  return (
    <div ref={feature.ref} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <ConnectionField
          id="connection-oracle-sid"
          label="SID (statt Service-Name)"
          placeholder="ORCL"
          value={param("sid")}
          onChange={(event) => setParam("sid", event.target.value)}
          spellCheck={false}
        />
        <div className="grid gap-1">
          <Label
            htmlFor="connection-oracle-privilege"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            Anmelden als {feature.isNew && <NewBadge />}
          </Label>
          <Select
            value={privilege}
            onValueChange={(value) => setParam("privilege", value === "normal" ? "" : value)}
          >
            <SelectTrigger id="connection-oracle-privilege" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {PRIVILEGES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === "normal" ? "Normal" : value.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <label
        htmlFor="connection-oracle-tcps"
        className="flex items-center justify-between gap-3 text-xs font-medium"
      >
        <span className="flex flex-col gap-0.5">
          <span>TCPS (TLS)</span>
          <span className="font-normal text-muted-foreground">
            Verschlüsselte Verbindung, meist auf Port 2484.
          </span>
        </span>
        <Switch
          id="connection-oracle-tcps"
          checked={tcps}
          onCheckedChange={(enabled) => {
            const cleared = withSearchParam(extraParams, "ssl", "");
            const next = withSearchParam(cleared, "protocol", enabled ? "tcps" : "");
            setExtraParams(enabled ? next : withSearchParam(next, "wallet", ""));
          }}
          aria-label="TCPS (TLS)"
        />
      </label>
      {tcps && (
        <ConnectionField
          id="connection-oracle-wallet"
          label="Wallet-Verzeichnis (optional)"
          placeholder="/pfad/zum/wallet"
          value={param("wallet")}
          onChange={(event) => setParam("wallet", event.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}
