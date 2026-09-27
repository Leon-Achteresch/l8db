import type { ExtensionDescriptor, Json } from "@/lib/extensions/contracts";
import type { ExtensionManager } from "@/lib/extensions/manager";
import { useExtensionSnapshot } from "@/lib/extensions/react-context";

export const PASSWORD_MANAGER_ID = "l8db.password-manager";

export type VaultProvider = "bitwarden" | "1password" | "keeper";

export interface VaultStatus {
  provider: VaultProvider;
  cli: string | null;
  state: "signed-out" | "locked" | "signed-in";
  account?: string;
  server?: string;
  accounts?: { id: string; label: string }[];
  needs?: "code" | "terminal";
}

export interface VaultSyncResult {
  total: number;
  added: number;
  updated: number;
  removed: number;
  hidden: number;
  skipped: string[];
}

export const VAULT_PROVIDERS: {
  id: VaultProvider;
  name: string;
  tagline: string;
  mark: string;
  tone: string;
  manual: string;
  team: string;
  entry: string;
  website: string;
}[] = [
  {
    id: "bitwarden",
    name: "Bitwarden",
    tagline: "Cloud oder selbst gehostet",
    mark: "B",
    tone: "bg-[#175ddc] text-white",
    manual: "https://bitwarden.com/help/cli/#download-and-install",
    team: "in der Sammlung",
    entry: "Anmeldung",
    website: "Website (URI)",
  },
  {
    id: "1password",
    name: "1Password",
    tagline: "Über die Desktop-App",
    mark: "1",
    tone: "bg-[#0a2d4d] text-white",
    manual: "https://developer.1password.com/docs/cli/get-started/",
    team: "im geteilten Tresor",
    entry: "Login",
    website: "Website",
  },
  {
    id: "keeper",
    name: "Keeper",
    tagline: "Keeper Commander",
    mark: "K",
    tone: "bg-[#ffc700] text-black",
    manual: "https://docs.keeper.io/en/keeperpam/commander-cli/commander-installation-setup",
    team: "im geteilten Ordner",
    entry: "Login",
    website: "Website-Adresse",
  },
];

export function vaultProvider(id: unknown) {
  return VAULT_PROVIDERS.find((provider) => provider.id === id);
}

export async function vaultSetup(host: ExtensionManager, request: Record<string, Json>) {
  return (await host.executeCommand("vault.setup", request)) as unknown as VaultStatus;
}

export async function vaultSync(host: ExtensionManager) {
  return (await host.executeCommand("vault.sync", { quiet: true })) as unknown as VaultSyncResult;
}

export function hasCommand(extension: ExtensionDescriptor, command: string) {
  return !!extension.archive.manifest.contributes?.commands?.some((entry) => entry.id === command);
}

export async function vaultSave(host: ExtensionManager, id: string) {
  await host.executeCommand("vault.save", { id });
}

export function usePasswordManager() {
  return useExtensionSnapshot((manager) => {
    const extension = manager
      .listExtensions()
      .find((entry) => entry.archive.manifest.id === PASSWORD_MANAGER_ID);
    if (!extension?.enabled || extension.state === "failed" || !hasCommand(extension, "vault.save"))
      return null;
    return vaultProvider(extension.configuration["vault.provider"]) ?? null;
  });
}

export function errorText(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(/^(\w*Error: )+/, "");
}
