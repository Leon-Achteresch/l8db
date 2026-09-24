import { LockKeyhole } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { ProviderLogo } from "@/components/provider-logo";
import type { SavedConnection } from "@/lib/connections";
import { ConnectionAdvancedOptions } from "../connection-advanced-options";
import { ConnectionField } from "../connection-field";
import { DriverMissingNotice } from "./driver-missing-notice";
import { ConnectionFileInput } from "./file-input";
import { ConnectionHostFields } from "./host-fields";
import { ConnectionTestResultStatus } from "./test-result-status";
import { ConnectionTnsInputs } from "./tns-inputs";
import { ConnectionUrlInput } from "./url-input";
import type { useConnectionEditor } from "./use-connection-editor";

export function ConnectionDetailsStep({
  editor,
  connection,
}: {
  editor: ReturnType<typeof useConnectionEditor>;
  connection: SavedConnection | undefined;
}) {
  const {
    activeInfo,
    advancedOpen,
    applySshConfig,
    caps,
    color,
    database,
    databaseLabel,
    elapsed,
    file,
    guided,
    host,
    info,
    kind,
    mode,
    name,
    network,
    password,
    pickFile,
    poolerWarning,
    port,
    provider,
    quickInfo,
    quickKind,
    quickProviderId,
    readOnly,
    result,
    scanError,
    scanSchemas,
    scannedSchemas,
    scannedUser,
    scanning,
    schemaFilter,
    showSingleSchemaSwitcher,
    setColor,
    setDatabase,
    setFile,
    setHost,
    setName,
    setPassword,
    setPort,
    setProvider,
    setReadOnly,
    setSchemaFilter,
    setShowSingleSchemaSwitcher,
    setShowPassword,
    setSshAuth,
    setSshEnabled,
    setSshHost,
    setSshKey,
    setSshPassword,
    setSshPort,
    setSshUser,
    setSsl,
    setStep,
    setTags,
    setTns,
    setTnsAlias,
    setTrusted,
    setUser,
    setValue,
    showPassword,
    sshAuth,
    sshEnabled,
    sshHost,
    sshKey,
    sshPassword,
    sshPort,
    sshUser,
    ssl,
    switchMode,
    tags,
    tns,
    tnsAlias,
    trusted,
    user,
    value,
    windowsAuth,
  } = editor;
  return (
    <div className="flex flex-col gap-3 pr-1">
      {!activeInfo.driver_status.available && (
        <DriverMissingNotice
          activeInfo={activeInfo}
          mode={mode}
          quickKind={quickKind}
          kind={kind}
        />
      )}
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-background ring-1 ring-border">
          <ProviderLogo
            providerId={mode === "string" ? quickProviderId : provider}
            kind={mode === "string" ? quickKind : kind}
            className="size-4"
          />
        </span>
        <div className="min-w-0 flex-1">
          <ConnectionField
            id="connection-name"
            label="Name"
            placeholder="Lokal, Staging, Produktion"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      {guided && (
        <button
          type="button"
          className="self-start text-[11px] text-muted-foreground underline"
          onClick={() => setStep(1)}
        >
          Andere Datenbank wählen
        </button>
      )}
      {!info.file_based && (
        <SegmentedControl
          value={mode}
          onChange={switchMode}
          label="Verbindungseingabe"
          options={[
            { value: "fields", label: "Felder" },
            { value: "string", label: "URL" },
            ...(kind === "oracle" ? [{ value: "tns" as const, label: "TNS" }] : []),
          ]}
        />
      )}
      {mode === "string" ? (
        <ConnectionUrlInput
          quickInfo={quickInfo}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          value={value}
          setValue={setValue}
          setSsl={setSsl}
          setProvider={setProvider}
          pickFile={pickFile}
        />
      ) : mode === "tns" ? (
        <ConnectionTnsInputs
          tns={tns}
          setTns={setTns}
          tnsAlias={tnsAlias}
          setTnsAlias={setTnsAlias}
          user={user}
          setUser={setUser}
          password={password}
          setPassword={setPassword}
        />
      ) : info.file_based ? (
        <ConnectionFileInput info={info} file={file} setFile={setFile} pickFile={pickFile} />
      ) : (
        <ConnectionHostFields
          info={info}
          kind={kind}
          host={host}
          setHost={setHost}
          port={port}
          setPort={setPort}
          database={database}
          setDatabase={setDatabase}
          databaseLabel={databaseLabel}
          trusted={trusted}
          setTrusted={setTrusted}
          windowsAuth={windowsAuth}
          user={user}
          setUser={setUser}
          password={password}
          setPassword={setPassword}
        />
      )}
      {mode === "string" && value.trim() ? (
        <p className="truncate text-[11px] text-muted-foreground">Erkannt: {quickInfo.name}</p>
      ) : null}
      {kind === "oracle" && mode === "string" && (
        <p className="text-[11px] text-muted-foreground">
          Oracle geht auch als Key-Value: User Id=scott;Password=tiger;Data Source=host:1521/service
        </p>
      )}
      {poolerWarning && (
        <p
          role="status"
          className="min-w-0 break-words rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 [overflow-wrap:anywhere] dark:text-amber-300"
        >
          Du nutzt einen Transaction Pooler. Für den vollständigen SQL-Arbeitsplatz nutze eine
          direkte Verbindung oder den Session Pooler auf Port 5432.
        </p>
      )}
      <ConnectionAdvancedOptions
        caps={caps}
        defaultOpen={advancedOpen}
        ssl={ssl}
        onSsl={setSsl}
        readOnly={readOnly}
        onReadOnly={setReadOnly}
        sshEnabled={sshEnabled}
        onSshEnabled={setSshEnabled}
        sshHost={sshHost}
        onSshHost={setSshHost}
        sshPort={sshPort}
        onSshPort={setSshPort}
        sshUser={sshUser}
        onSshUser={setSshUser}
        sshAuth={sshAuth}
        onSshAuth={setSshAuth}
        sshKey={sshKey}
        onSshKey={setSshKey}
        sshPassword={sshPassword}
        onSshPassword={setSshPassword}
        network={network}
        onApplySshConfig={applySshConfig}
        tags={tags}
        onTags={setTags}
        color={color}
        onColor={setColor}
        schemaFilter={schemaFilter}
        onSchemaFilter={setSchemaFilter}
        showSingleSchemaSwitcher={showSingleSchemaSwitcher}
        onShowSingleSchemaSwitcher={setShowSingleSchemaSwitcher}
        scannedSchemas={scannedSchemas}
        scannedUser={scannedUser}
        scanning={scanning}
        scanError={scanError}
        onScan={() => void scanSchemas()}
        connection={connection}
      />
      <ConnectionTestResultStatus result={result} elapsed={elapsed} />
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <LockKeyhole className="size-3" />
        Passwörter bleiben im System-Schlüsselbund
      </p>
    </div>
  );
}
