import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ExtensionDescriptor, Permission } from "@/lib/extensions/contracts";
import { useExtensionHost } from "@/lib/extensions/react-context";
import { PERMISSION_LABELS } from "./permission-labels";

export function ExtensionPermissionConsent({
  extension,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  extension: ExtensionDescriptor;
  confirmLabel: string;
  onCancel?: () => void;
  onConfirm: (grants: Permission[]) => void;
}) {
  const host = useExtensionHost();
  const { manifest } = extension.archive;
  const declared = manifest.permissions ?? [];
  const supported = (permission: Permission) => host.permissions.supported.includes(permission);
  const [grants, setGrants] = useState<Permission[]>(
    extension.enabled ? extension.grants : declared.filter(supported),
  );
  const detail = (permission: Permission) =>
    permission === "process:execute"
      ? manifest.capabilities?.process?.commands.join(", ")
      : permission === "network"
        ? manifest.capabilities?.network?.hosts.join(", ")
        : undefined;

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {declared.map((permission) => (
          <li key={permission} className="flex items-start gap-2.5">
            <Checkbox
              id={`${manifest.id}-${permission}`}
              className="mt-0.5"
              checked={grants.includes(permission)}
              disabled={!supported(permission)}
              onCheckedChange={(checked) =>
                setGrants((previous) =>
                  checked === true
                    ? [...previous, permission]
                    : previous.filter((entry) => entry !== permission),
                )
              }
            />
            <label htmlFor={`${manifest.id}-${permission}`} className="min-w-0 text-xs">
              <span className="block font-medium">{PERMISSION_LABELS[permission]}</span>
              <span className="block break-words font-mono text-[11px] text-muted-foreground">
                {permission}
                {detail(permission) && ` · ${detail(permission)}`}
                {!supported(permission) && " · wird nicht unterstützt"}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
        )}
        <Button size="sm" onClick={() => onConfirm(grants)}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
