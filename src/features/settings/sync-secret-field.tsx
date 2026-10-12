import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteSecret, storeSecret } from "@/lib/db";
import { errorMessage } from "@/lib/sync/controller";
import { type SyncSecretKind, useSyncStore } from "@/lib/sync/store";

interface Props {
  kind: SyncSecretKind;
  account: string;
  label: string;
  placeholder: string;
  minLength?: number;
}

export function SyncSecretField({ kind, account, label, placeholder, minLength = 1 }: Props) {
  const stored = useSyncStore((state) => state.storedSecrets[kind]);
  const markSecret = useSyncStore((state) => state.markSecret);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (draft.length < minLength) {
      toast.error(`${label} muss mindestens ${minLength} Zeichen lang sein.`);
      return;
    }
    setBusy(true);
    try {
      await storeSecret(account, draft);
      markSecret(kind, true);
      setDraft("");
      toast.success(`${label} im Schlüsselbund gespeichert`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await deleteSecret(account);
      markSecret(kind, false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="password"
        autoComplete="off"
        aria-label={label}
        placeholder={stored ? "Im Schlüsselbund hinterlegt" : placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft) void save();
        }}
        className="h-8 w-56 text-xs"
      />
      <Button size="sm" variant="outline" disabled={busy || !draft} onClick={() => void save()}>
        <KeyRoundIcon className="size-3.5" />
        Speichern
      </Button>
      {stored && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
          Entfernen
        </Button>
      )}
    </div>
  );
}
