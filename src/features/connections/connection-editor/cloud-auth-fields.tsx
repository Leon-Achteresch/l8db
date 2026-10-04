import { Cloud } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { NewBadge } from "@/components/new-badge";
import { type CloudAuthMode, cloudAuthModes } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { ConnectionField } from "../connection-field";
import type { CloudAuthDraft } from "./use-cloud-auth-draft";

const LABELS: Record<CloudAuthMode, string> = {
  password: "Passwort",
  aws_iam: "AWS IAM",
  entra: "Entra ID",
};

export function ConnectionCloudAuthFields({
  kind,
  draft,
}: {
  kind: DatabaseKind;
  draft: CloudAuthDraft;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("connections.editor.cloud-auth");
  const modes = cloudAuthModes(kind);
  if (!modes.length) return null;
  const mode = modes.includes(draft.mode) ? draft.mode : "password";
  return (
    <div ref={feature.ref} className="space-y-2">
      <span className="flex items-center gap-2 text-xs font-medium">
        <Cloud className="size-4 text-muted-foreground" /> Anmeldung
        {feature.isNew && <NewBadge />}
      </span>
      <SegmentedControl
        value={mode}
        onChange={draft.setMode}
        label="Anmeldeverfahren"
        options={modes.map((value) => ({ value, label: LABELS[value] }))}
      />
      {mode === "aws_iam" && (
        <div className="grid grid-cols-2 gap-3">
          <ConnectionField
            id="connection-aws-profile"
            label="AWS-Profil (optional)"
            placeholder="default"
            value={draft.awsProfile}
            onChange={(event) => draft.setAwsProfile(event.target.value)}
          />
          <ConnectionField
            id="connection-aws-region"
            label="Region (optional)"
            placeholder="aus Host oder Profil"
            value={draft.awsRegion}
            onChange={(event) => draft.setAwsRegion(event.target.value)}
          />
        </div>
      )}
      {mode === "entra" && (
        <ConnectionField
          id="connection-entra-tenant"
          label="Tenant (optional)"
          placeholder="Standard der Azure CLI"
          value={draft.tenant}
          onChange={(event) => draft.setTenant(event.target.value)}
        />
      )}
      {mode !== "password" && (
        <p className="text-[11px] text-muted-foreground">
          {mode === "aws_iam"
            ? "Erzeugt bei jedem Verbindungsaufbau ein RDS-Token (15 Min.) aus deinen AWS-Anmeldedaten. TLS ist dabei Pflicht."
            : "Holt ein Zugriffstoken über die Azure CLI (az login erforderlich). TLS ist dabei Pflicht."}
        </p>
      )}
    </div>
  );
}
