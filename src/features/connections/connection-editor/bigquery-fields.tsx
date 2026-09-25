import { SegmentedControl } from "@/components/motion/segmented-control";
import { searchParam, withSearchParam } from "@/lib/connection-url";
import { ConnectionField } from "../connection-field";
import { ConnectionSecretArea } from "./secret-area";

type BigqueryAuth = "adc" | "service_account" | "token" | "none";

const AUTH_OPTIONS: { value: BigqueryAuth; label: string }[] = [
  { value: "adc", label: "Standard (ADC)" },
  { value: "service_account", label: "Service-Account" },
  { value: "token", label: "Token" },
  { value: "none", label: "Ohne" },
];

export function ConnectionBigqueryFields({
  host,
  setHost,
  database,
  setDatabase,
  user,
  setUser,
  password,
  setPassword,
  extraParams,
  setExtraParams,
}: {
  host: string;
  setHost: (value: string) => void;
  database: string;
  setDatabase: (value: string) => void;
  user: string;
  setUser: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  extraParams: string;
  setExtraParams: (value: string) => void;
}) {
  const auth = AUTH_OPTIONS.some((option) => option.value === user)
    ? (user as BigqueryAuth)
    : "adc";
  const param = (key: string) => searchParam(extraParams, key);
  const setParam = (key: string, value: string) =>
    setExtraParams(withSearchParam(extraParams, key, value));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <ConnectionField
          id="connection-bigquery-project"
          label="Projekt-ID"
          placeholder="my-project"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          spellCheck={false}
        />
        <ConnectionField
          id="connection-bigquery-dataset"
          label="Standard-Dataset (optional)"
          value={database}
          onChange={(event) => setDatabase(event.target.value)}
          spellCheck={false}
        />
      </div>
      <ConnectionField
        id="connection-bigquery-location"
        label="Location (optional)"
        placeholder="EU, US, europe-west3"
        value={param("location")}
        onChange={(event) => setParam("location", event.target.value)}
      />
      <SegmentedControl
        value={auth}
        onChange={(next) => {
          setUser(next === "adc" ? "" : next);
          if (next !== "service_account") setParam("credentials_file", "");
          if (next === "adc" || next === "none") setPassword("");
        }}
        label="BigQuery-Anmeldung"
        options={AUTH_OPTIONS}
      />
      {auth === "adc" && (
        <p className="text-[11px] text-muted-foreground">
          Nutzt GOOGLE_APPLICATION_CREDENTIALS oder die gcloud-Anmeldung (gcloud auth
          application-default login).
        </p>
      )}
      {auth === "service_account" && (
        <>
          <ConnectionSecretArea
            id="connection-bigquery-key"
            label="Service-Account-Schlüssel (JSON)"
            placeholder='{"type": "service_account", …}'
            value={password}
            onChange={setPassword}
          />
          <ConnectionField
            id="connection-bigquery-key-file"
            label="Oder Pfad zur Schlüsseldatei"
            placeholder="/Users/name/keys/service-account.json"
            value={param("credentials_file")}
            onChange={(event) => setParam("credentials_file", event.target.value)}
            spellCheck={false}
          />
        </>
      )}
      {auth === "token" && (
        <ConnectionField
          id="connection-bigquery-token"
          label="OAuth-Zugriffstoken"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      )}
      {auth === "none" && (
        <p className="text-[11px] text-muted-foreground">
          Nur für Emulatoren ohne Anmeldung, z. B. bigquery-emulator.
        </p>
      )}
      <ConnectionField
        id="connection-bigquery-endpoint"
        label="API-Endpunkt (optional)"
        placeholder="http://localhost:9050"
        value={param("endpoint")}
        onChange={(event) => setParam("endpoint", event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
