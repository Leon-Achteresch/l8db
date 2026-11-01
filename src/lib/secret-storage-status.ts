import { create } from "zustand";

interface SecretStorageState {
  failedAccounts: string[];
}

export const useSecretStorageStatus = create<SecretStorageState>(() => ({ failedAccounts: [] }));

export function reportSecretStorage(account: string, stored: boolean): void {
  const current = useSecretStorageStatus.getState().failedAccounts;
  if (stored ? !current.includes(account) : current.includes(account)) return;
  useSecretStorageStatus.setState({
    failedAccounts: stored
      ? current.filter((entry) => entry !== account)
      : [...current.slice(-127), account],
  });
}
