import { open } from "@tauri-apps/plugin-dialog";
import { defaultSslModeForProvider } from "@/lib/connection-defaults";
import {
  connectionError,
  detectProvider,
  filePath,
  isTrustedConnection,
  kindFromUrl,
  oracleConnectString,
  parseConnectionUrl,
} from "@/lib/connection-url";
import type { DatabaseKind, ProviderInfo, SslMode } from "@/lib/db";
import { useSettingsStore } from "@/lib/settings";
import { placeholderDefaults } from "./seed";
import type { Mode, TestResult } from "./types";

export interface ConnectionInputActionsContext {
  providers: ProviderInfo[];
  mode: Mode;
  setProvider: (value: string) => void;
  setMode: (value: Mode) => void;
  setPreview: (kind: DatabaseKind | null, providerId?: string | null) => void;
  setResult: (value: TestResult) => void;
  setHost: (value: string) => void;
  setPort: (value: string) => void;
  setDatabase: (value: string) => void;
  setUser: (value: string) => void;
  setPassword: (value: string) => void;
  setExtraParams: (value: string) => void;
  setTrusted: (value: boolean) => void;
  setFile: (value: string) => void;
  setTnsAlias: (value: string) => void;
  setValue: (value: string) => void;
  value: string;
  setSsl: (value: SslMode) => void;
  step: 1 | 2;
  setStep: (value: 1 | 2) => void;
  kind: DatabaseKind;
  info: ProviderInfo;
  makeUrl: () => string;
}

export function createConnectionInputActions(ctx: ConnectionInputActionsContext) {
  const {
    providers,
    mode,
    setProvider,
    setMode,
    setPreview,
    setResult,
    setHost,
    setPort,
    setDatabase,
    setUser,
    setPassword,
    setExtraParams,
    setTrusted,
    setFile,
    setTnsAlias,
    setValue,
    value,
    setSsl,
    step,
    setStep,
    kind,
    info,
    makeUrl,
  } = ctx;

  function selectProvider(id: string) {
    const next = providers.find((entry) => entry.id === id);
    if (!next) return;
    setProvider(id);
    if (mode === "tns" && next.kind !== "oracle") setMode("fields");
    setPreview(next.kind, next.id);
    setResult({ status: "idle" });
    const nextDefaults = placeholderDefaults(next);
    setHost(nextDefaults.host);
    setPort(nextDefaults.port);
    setDatabase(nextDefaults.database);
    setUser(nextDefaults.user);
    if (!value)
      setSsl(
        defaultSslModeForProvider(next.kind, next.id, useSettingsStore.getState().sslDefaultMode),
      );
    if (step === 1 && next.driver_status.available) setStep(2);
  }

  function pasteConnectionString(url?: string) {
    if (url) setValue(url);
    setMode("string");
    setResult({ status: "idle" });
    setStep(2);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    try {
      if (next !== "string" && value.trim()) {
        const inputKind = kindFromUrl(value) ?? kind;
        const inputInfo = providers.find((entry) => entry.kind === inputKind) ?? info;
        setProvider(detectProvider(value, inputKind));
        if (inputInfo.file_based) setFile(filePath(value));
        else {
          const url = parseConnectionUrl(value, inputKind);
          const alias = inputKind === "oracle" ? oracleConnectString(url) : null;
          if (alias) setTnsAlias(alias);
          setHost(url.hostname);
          setPort(url.port || String(inputInfo.default_port ?? ""));
          setDatabase(decodeURIComponent(url.pathname.slice(1)));
          setUser(decodeURIComponent(url.username));
          setPassword(decodeURIComponent(url.password));
          setExtraParams(url.search);
          setTrusted(isTrustedConnection(url));
        }
      } else if (next === "string") setValue(info.file_based ? filePath(makeUrl()) : makeUrl());
      setMode(next);
      setResult({ status: "idle" });
    } catch (error) {
      setResult({ status: "error", message: connectionError(error) });
    }
  }

  async function pickFile() {
    try {
      const picked = await open({ multiple: false, directory: false });
      if (typeof picked !== "string") return;
      if (mode === "string") setValue(picked);
      else setFile(picked);
      setResult({ status: "idle" });
    } catch (error) {
      setResult({ status: "error", message: connectionError(error) });
    }
  }

  return { selectProvider, pasteConnectionString, switchMode, pickFile };
}
