import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import { type CreateSubscriptionRequest, createSubscription } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export function CreateSubscriptionDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [publications, setPublications] = useState("");
  const [slotName, setSlotName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [connect, setConnect] = useState(true);

  const handleSave = async () => {
    if (!connection || !name.trim() || !providerUrl.trim() || !publications.trim()) return;
    setSaving(true);
    try {
      const request: CreateSubscriptionRequest = {
        name: name.trim(),
        connection_string: providerUrl.trim(),
        publications: publications
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        enabled,
        connect,
      };
      if (slotName.trim()) request.slot_name = slotName.trim();
      await createSubscription(
        connection.kind,
        effectiveConnectionString(connection),
        request,
        database ?? undefined,
      );
      toast.success(`Subskription "${name.trim()}" erstellt.`);
      onSuccess();
      onOpenChange(false);
      setName("");
      setProviderUrl("");
      setPublications("");
      setSlotName("");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Neue Subskription</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. app_sub"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Provider-Connection-String</Label>
            <Input
              value={providerUrl}
              onChange={(e) => setProviderUrl(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="postgresql://user:pass@host:5432/db"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Publikationen (kommagetrennt)</Label>
            <Input
              value={publications}
              onChange={(e) => setPublications(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. app_pub"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Slot-Name (optional, Standard = Subskriptions-Name)</Label>
            <Input
              value={slotName}
              onChange={(e) => setSlotName(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            Aktiviert (Worker starten)
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Switch checked={connect} onCheckedChange={setConnect} />
            <span>
              Sofort verbinden
              <span className="block text-muted-foreground">
                Aus = nur anlegen ohne Provider-Kontakt, z. B. wenn der Provider gerade nicht
                erreichbar ist.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !name.trim() || !providerUrl.trim() || !publications.trim()}
          >
            {saving ? "Erstellen…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
