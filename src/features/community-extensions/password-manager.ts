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

export const VAULT_PROVIDERS: {
  id: VaultProvider;
  name: string;
  tagline: string;
  mark: string;
  tone: string;
  manual: string;
}[] = [
  {
    id: "bitwarden",
    name: "Bitwarden",
    tagline: "Cloud oder selbst gehostet",
    mark: "B",
    tone: "bg-[#175ddc] text-white",
    manual: "https://bitwarden.com/help/cli/#download-and-install",
  },
  {
    id: "1password",
    name: "1Password",
    tagline: "Über die Desktop-App",
    mark: "1",
    tone: "bg-[#0a2d4d] text-white",
    manual: "https://developer.1password.com/docs/cli/get-started/",
  },
  {
    id: "keeper",
    name: "Keeper",
    tagline: "Keeper Commander",
    mark: "K",
    tone: "bg-[#ffc700] text-black",
    manual: "https://docs.keeper.io/en/keeperpam/commander-cli/commander-installation-setup",
  },
];

export function vaultProvider(id: unknown) {
  return VAULT_PROVIDERS.find((provider) => provider.id === id);
}

export async function vaultSetup(host: ExtensionManager, request: Record<string, Json>) {
  return (await host.executeCommand("vault.setup", request)) as unknown as VaultStatus;
}

export function errorText(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(/^(\w*Error: )+/, "");
}
