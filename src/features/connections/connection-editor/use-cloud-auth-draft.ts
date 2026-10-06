import { useState } from "react";
import {
  activeCloudAuth,
  type CloudAuth,
  type CloudAuthMode,
  type SavedConnection,
} from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";

export function useCloudAuthDraft(seed: Partial<SavedConnection> | undefined) {
  const [mode, setMode] = useState<CloudAuthMode>(seed?.cloudAuth?.mode ?? "password");
  const [awsProfile, setAwsProfile] = useState(seed?.cloudAuth?.awsProfile ?? "");
  const [awsRegion, setAwsRegion] = useState(seed?.cloudAuth?.awsRegion ?? "");
  const [tenant, setTenant] = useState(seed?.cloudAuth?.tenant ?? "");

  function resolve(kind: DatabaseKind): CloudAuth | null {
    if (mode === "password") return null;
    return activeCloudAuth(kind, {
      mode,
      awsProfile: mode === "aws_iam" ? awsProfile.trim() || null : null,
      awsRegion: mode === "aws_iam" ? awsRegion.trim() || null : null,
      tenant: mode === "entra" ? tenant.trim() || null : null,
    });
  }

  return {
    mode,
    setMode,
    awsProfile,
    setAwsProfile,
    awsRegion,
    setAwsRegion,
    tenant,
    setTenant,
    resolve,
  };
}

export type CloudAuthDraft = ReturnType<typeof useCloudAuthDraft>;
