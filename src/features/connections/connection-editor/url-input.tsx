import { Eye, EyeOff, FolderOpen as FolderOpenData } from "lucide";
import { MorphIcon } from "morphicons/react";
import { initialSslMode } from "@/lib/connection-defaults";
import { detectProvider, kindFromUrl } from "@/lib/connection-url";
import type { ProviderInfo, SslMode } from "@/lib/db";
import { useSettingsStore } from "@/lib/settings";
import { ConnectionField } from "../connection-field";

export function ConnectionUrlInput({
  quickInfo,
  showPassword,
  setShowPassword,
  value,
  setValue,
  setSsl,
  setProvider,
  pickFile,
}: {
  quickInfo: ProviderInfo;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  value: string;
  setValue: (value: string) => void;
  setSsl: (value: SslMode) => void;
  setProvider: (value: string) => void;
  pickFile: () => Promise<void>;
}) {
  return (
    <div className="relative">
      <ConnectionField
        id="connection-url"
        label={quickInfo.file_based ? "Datenbankdatei" : "Connection-String"}
        type={quickInfo.file_based || showPassword ? "text" : "password"}
        placeholder={quickInfo.placeholder}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          if (nextValue.trim()) {
            const nextKind = kindFromUrl(nextValue);
            setSsl(
              initialSslMode(
                nextValue,
                useSettingsStore.getState().sslDefaultMode,
                undefined,
                nextKind,
                nextKind ? detectProvider(nextValue, nextKind) : undefined,
              ),
            );
          }
          const inputKind = kindFromUrl(nextValue);
          if (inputKind) setProvider(detectProvider(nextValue, inputKind));
        }}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        aria-label={
          quickInfo.file_based ? "Datei auswählen" : showPassword ? "URL verbergen" : "URL anzeigen"
        }
        onClick={() => (quickInfo.file_based ? void pickFile() : setShowPassword(!showPassword))}
        className="absolute right-2 bottom-2 rounded bg-card p-1 text-muted-foreground"
      >
        <MorphIcon
          icon={quickInfo.file_based ? FolderOpenData : showPassword ? EyeOff : Eye}
          className="size-4"
        />
      </button>
    </div>
  );
}
