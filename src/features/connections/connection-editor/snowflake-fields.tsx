import { SegmentedControl } from "@/components/motion/segmented-control";
import { joinKeySecret, searchParam, splitKeySecret, withSearchParam } from "@/lib/connection-url";
import { ConnectionField } from "../connection-field";
import { ConnectionSecretArea } from "./secret-area";

type SnowflakeAuth = "snowflake_jwt" | "programmatic_access_token" | "oauth";

const AUTH_OPTIONS: { value: SnowflakeAuth; label: string }[] = [
  { value: "snowflake_jwt", label: "Key-Pair" },
  { value: "programmatic_access_token", label: "Access Token" },
  { value: "oauth", label: "OAuth" },
];

export function ConnectionSnowflakeFields({
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
  const param = (key: string) => searchParam(extraParams, key);
  const setParam = (key: string, value: string) =>
    setExtraParams(withSearchParam(extraParams, key, value));
  const keyFile = param("private_key_file");
  const explicit = param("authenticator").toLowerCase();
  const auth: SnowflakeAuth = AUTH_OPTIONS.some((option) => option.value === explicit)
    ? (explicit as SnowflakeAuth)
    : keyFile || password.includes("-----BEGIN")
      ? "snowflake_jwt"
      : "programmatic_access_token";
  const key = splitKeySecret(password);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <ConnectionField
          id="connection-snowflake-account"
          label="Account-Identifier"
          placeholder="myorg-account1"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          spellCheck={false}
        />
        <ConnectionField
          id="connection-snowflake-user"
          label="Benutzer"
          value={user}
          onChange={(event) => setUser(event.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ConnectionField
          id="connection-snowflake-database"
          label="Datenbank"
          value={database}
          onChange={(event) => setDatabase(event.target.value)}
          spellCheck={false}
        />
        <ConnectionField
          id="connection-snowflake-schema"
          label="Schema"
          placeholder="PUBLIC"
          value={param("schema")}
          onChange={(event) => setParam("schema", event.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ConnectionField
          id="connection-snowflake-warehouse"
          label="Warehouse"
          placeholder="COMPUTE_WH"
          value={param("warehouse")}
          onChange={(event) => setParam("warehouse", event.target.value)}
          spellCheck={false}
        />
        <ConnectionField
          id="connection-snowflake-role"
          label="Rolle"
          placeholder="ANALYST"
          value={param("role")}
          onChange={(event) => setParam("role", event.target.value)}
          spellCheck={false}
        />
      </div>
      <SegmentedControl
        value={auth}
        onChange={(next) => {
          const params = withSearchParam(extraParams, "authenticator", next);
          setExtraParams(
            next === "snowflake_jwt" ? params : withSearchParam(params, "private_key_file", ""),
          );
          setPassword("");
        }}
        label="Snowflake-Anmeldung"
        options={AUTH_OPTIONS}
      />
      {auth === "snowflake_jwt" && (
        <>
          <ConnectionField
            id="connection-snowflake-key-file"
            label="Pfad zum privaten Schlüssel (optional)"
            placeholder="/Users/name/.ssh/rsa_key.p8"
            value={keyFile}
            onChange={(event) => setParam("private_key_file", event.target.value)}
            spellCheck={false}
          />
          {!keyFile && (
            <ConnectionSecretArea
              id="connection-snowflake-key"
              label="Privater Schlüssel (PEM)"
              placeholder="-----BEGIN PRIVATE KEY-----"
              value={key.pem}
              onChange={(pem) => setPassword(joinKeySecret(pem, key.passphrase))}
            />
          )}
          <ConnectionField
            id="connection-snowflake-passphrase"
            label="Passphrase (nur bei verschlüsseltem Schlüssel)"
            type="password"
            autoComplete="new-password"
            value={keyFile ? password : key.passphrase}
            onChange={(event) =>
              setPassword(keyFile ? event.target.value : joinKeySecret(key.pem, event.target.value))
            }
          />
        </>
      )}
      {auth !== "snowflake_jwt" && (
        <ConnectionField
          id="connection-snowflake-token"
          label={auth === "oauth" ? "OAuth-Token" : "Programmatic Access Token"}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      )}
    </div>
  );
}
