import type { Json } from "@/lib/extensions/contracts";
import type { ExtensionManager } from "@/lib/extensions/manager";

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
  teamHint: string;
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
    teamHint:
      "Lege in der Bitwarden-Organisation eine Sammlung an, z. B. „Datenbanken“, und gib sie den Personen oder Gruppen frei, die die Zugänge brauchen.",
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
    teamHint:
      "Lege in 1Password einen Tresor an, z. B. „Datenbanken“, und gib ihn den Personen oder Gruppen frei, die die Zugänge brauchen.",
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
    teamHint:
      "Lege in Keeper einen geteilten Ordner an, z. B. „Datenbanken“, und füge die Personen oder Teams hinzu, die die Zugänge brauchen.",
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

export function errorText(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(/^(\w*Error: )+/, "");
}
