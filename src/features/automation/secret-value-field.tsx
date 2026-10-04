import { CheckIcon, KeyRoundIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/automation/toast";
import { deleteSecret, loadSecret, storeSecret } from "@/lib/secrets";

interface Props {
  account: string;
  label: string;
}

export function SecretValueField({ account, label }: Props) {
  const [stored, setStored] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setStored(null);
    loadSecret(account)
      .then((value) => alive && setStored(Boolean(value)))
      .catch(() => alive && setStored(false));
    return () => {
      alive = false;
    };
  }, [account]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await storeSecret(account, draft);
      setStored(true);
      setDraft("");
    } catch (error) {
      toast.error("Wert nicht im Schlüsselbund gespeichert", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteSecret(account);
      setStored(false);
    } catch (error) {
      toast.error("Wert nicht aus dem Schlüsselbund gelöscht", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="relative min-w-0 flex-1">
        <KeyRoundIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="password"
          autoComplete="off"
          aria-label={label}
          value={draft}
          placeholder={stored ? "•••••••• im Schlüsselbund" : "Wert eingeben"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          className="h-8 pl-8 text-[13px]"
        />
      </div>
      {draft ? (
        <Button type="button" size="sm" disabled={busy} onClick={() => void save()} className="h-8">
          <CheckIcon />
          Sichern
        </Button>
      ) : stored ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={`${label} aus dem Schlüsselbund löschen`}
          onClick={() => void remove()}
          className="size-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon />
        </Button>
      ) : null}
    </div>
  );
}
