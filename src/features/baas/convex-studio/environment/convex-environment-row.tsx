import { Check, Eye, EyeOff, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexSetEnvironmentVariable } from "@/lib/db";
import { convexStudioSettingsEnvReveal } from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment } from "../convex-studio-sections";

export function ConvexEnvironmentRow({
  deployment,
  name,
  onDelete,
}: {
  deployment: ConvexStudioDeployment;
  name: string;
  onDelete: (name: string) => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    try {
      const revealed = await convexStudioSettingsEnvReveal(deployment, name);
      if (revealed === null) toast.error(`${name} existiert nicht mehr.`);
      setValue(revealed);
      return revealed;
    } catch (reason) {
      toast.error(String(reason));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function edit() {
    const current = value ?? (await reveal());
    if (current !== null) setDraft(current);
  }

  async function save() {
    if (draft === null) return;
    setBusy(true);
    try {
      await convexSetEnvironmentVariable(
        deployment.profileId,
        deployment.projectId,
        deployment.deploymentName,
        name,
        draft,
      );
      setValue(value === null ? null : draft);
      setDraft(null);
      toast.success(`${name} gespeichert.`);
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t align-middle">
      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{name}</td>
      <td className="w-full px-3 py-2">
        {draft !== null ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              autoFocus
              className="h-7 font-mono text-xs"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={`Neuer Wert für ${name}`}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" size="icon-sm" disabled={busy} aria-label="Speichern">
              <Check className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Abbrechen"
              onClick={() => setDraft(null)}
            >
              <X className="size-3.5" />
            </Button>
          </form>
        ) : (
          <span className="block max-w-[48ch] truncate font-mono text-xs text-muted-foreground">
            {value ?? "••••••••"}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={value === null ? `${name} anzeigen` : `${name} verbergen`}
            onClick={() => (value === null ? void reveal() : setValue(null))}
          >
            {value === null ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy || draft !== null}
            aria-label={`${name} bearbeiten`}
            onClick={() => void edit()}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`${name} löschen`}
            className="hover:text-destructive"
            onClick={() => onDelete(name)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
