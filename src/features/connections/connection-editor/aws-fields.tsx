import { useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AWS_AUTO_REGION,
  AWS_REGIONS,
  type AwsAuthMode,
  awsAuthMode,
  awsParam,
  joinAwsSecret,
  splitAwsSecret,
  withAwsParam,
} from "@/lib/aws";
import type { DatabaseKind } from "@/lib/db";
import { ConnectionField } from "../connection-field";

export function ConnectionAwsFields({
  kind,
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
  kind: DatabaseKind;
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
  const [mode, setMode] = useState<AwsAuthMode>(() => awsAuthMode(user, extraParams));
  const { secret, token } = splitAwsSecret(password);
  const region = host.trim() || AWS_AUTO_REGION;
  const regions =
    AWS_REGIONS.includes(region) || region === AWS_AUTO_REGION
      ? AWS_REGIONS
      : [region, ...AWS_REGIONS];
  const param = (key: string) => awsParam(extraParams, key);
  const setParam = (key: string, value: string | null, keepEmpty = false) =>
    setExtraParams(withAwsParam(extraParams, key, value, keepEmpty));

  function switchMode(next: AwsAuthMode) {
    setMode(next);
    if (next !== "keys") {
      setUser("");
      setPassword("");
    }
    setParam("profile", next === "profile" ? param("profile") || "default" : null);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-1">
        <Label htmlFor="connection-aws-region" className="text-xs text-muted-foreground">
          Region
        </Label>
        <Select value={region} onValueChange={setHost}>
          <SelectTrigger id="connection-aws-region" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={AWS_AUTO_REGION}>Aus Profil oder Umgebung</SelectItem>
            {regions.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {entry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SegmentedControl
        value={mode}
        onChange={switchMode}
        label="AWS-Anmeldung"
        options={[
          { value: "keys", label: "Zugangsschlüssel" },
          { value: "profile", label: "Profil" },
          { value: "env", label: "Umgebung" },
        ]}
      />
      {mode === "keys" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <ConnectionField
              id="connection-aws-access-key"
              label="Access Key ID"
              autoComplete="off"
              value={user}
              onChange={(event) => setUser(event.target.value)}
            />
            <ConnectionField
              id="connection-aws-secret"
              label="Secret Access Key"
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(event) => setPassword(joinAwsSecret(event.target.value, token))}
            />
          </div>
          <ConnectionField
            id="connection-aws-token"
            label="Session Token (optional)"
            type="password"
            autoComplete="new-password"
            value={token}
            onChange={(event) => setPassword(joinAwsSecret(secret, event.target.value))}
          />
        </>
      )}
      {mode === "profile" && (
        <ConnectionField
          id="connection-aws-profile"
          label="Profil aus ~/.aws/config"
          placeholder="default"
          value={param("profile")}
          onChange={(event) => setParam("profile", event.target.value, true)}
        />
      )}
      {mode !== "keys" && (
        <p className="text-[11px] text-muted-foreground">
          {mode === "profile"
            ? "Unterstützt Schlüssel, credential_process und AWS SSO (vorher aws sso login ausführen)."
            : "Nutzt AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY oder AWS_PROFILE und ~/.aws. Aus dem Finder gestartete Apps sehen keine Shell-Variablen."}
        </p>
      )}
      {kind === "athena" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <ConnectionField
              id="connection-athena-catalog"
              label="Katalog"
              placeholder="AwsDataCatalog"
              value={database}
              onChange={(event) => setDatabase(event.target.value)}
            />
            <ConnectionField
              id="connection-athena-schema"
              label="Standard-Datenbank"
              placeholder="default"
              value={param("schema")}
              onChange={(event) => setParam("schema", event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ConnectionField
              id="connection-athena-workgroup"
              label="Workgroup"
              placeholder="primary"
              value={param("workgroup")}
              onChange={(event) => setParam("workgroup", event.target.value)}
            />
            <ConnectionField
              id="connection-athena-output"
              label="S3-Ausgabeort (optional)"
              placeholder="s3://bucket/athena-results/"
              value={param("output")}
              onChange={(event) => setParam("output", event.target.value)}
            />
          </div>
        </>
      )}
      <ConnectionField
        id="connection-aws-endpoint"
        label="Endpunkt (optional)"
        placeholder={
          kind === "dynamodb"
            ? "http://localhost:8000"
            : "https://athena.eu-central-1.amazonaws.com"
        }
        value={param("endpoint")}
        onChange={(event) => setParam("endpoint", event.target.value)}
      />
    </div>
  );
}
