import { invoke } from "./core";

export function decryptNavicatLegacyPasswords(values: string[]): Promise<Array<string | null>> {
  return invoke<Array<string | null>>("decrypt_navicat_legacy_passwords", { values });
}
