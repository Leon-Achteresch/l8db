import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/shell/workbench-dialog";
import { cloneChange, principalName } from "@/features/users/principal-view/principal-draft";
import { useApplyPrincipalChange } from "@/features/users/principal-view/use-apply-principal-change";
import type { PrincipalChange, PrincipalDetail, PrincipalKind } from "@/lib/db";
import { usePrincipalOptionsQuery, usePrincipalsQuery } from "@/lib/queries";

interface CreatePrincipalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PrincipalKind;
  template?: PrincipalDetail;
}

const TITLE: Record<PrincipalKind, string> = {
  user: "Neuer Benutzer",
  role: "Neue Rolle",
  profile: "Neues Profil",
};

export function CreatePrincipalDialog({
  open,
  onOpenChange,
  kind,
  template,
}: CreatePrincipalDialogProps) {
  const navigate = useNavigate();
  const apply = useApplyPrincipalChange();
  const { data: options } = usePrincipalOptionsQuery(open && kind === "user");
  const { data: principals } = usePrincipalsQuery(open && kind === "user");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [defaultTablespace, setDefaultTablespace] = useState(template?.default_tablespace ?? "");
  const [temporaryTablespace, setTemporaryTablespace] = useState(
    template?.temporary_tablespace ?? "",
  );
  const [profile, setProfile] = useState(template?.profile ?? "");
  const [expire, setExpire] = useState(false);
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);

  const user = kind === "user";
  const finalName = principalName(name);
  const ready = finalName !== "" && (!user || password !== "");
  const profiles = (principals?.items ?? [])
    .filter((item) => item.kind === "profile")
    .map((item) => item.name);
  const choices = [
    {
      id: "default-tablespace",
      label: "Standard-Tablespace",
      value: defaultTablespace,
      set: setDefaultTablespace,
      options: options?.tablespaces ?? [],
    },
    {
      id: "temporary-tablespace",
      label: "Temp-Tablespace",
      value: temporaryTablespace,
      set: setTemporaryTablespace,
      options: options?.temporary_tablespaces ?? [],
    },
    { id: "profile", label: "Profil", value: profile, set: setProfile, options: profiles },
  ];

  const create = async () => {
    if (!ready || saving) return;
    const base: PrincipalChange = template
      ? cloneChange(template, finalName, password)
      : { kind, name: finalName, action: "create", ...(user ? { password } : {}) };
    const change: PrincipalChange = user
      ? {
          ...base,
          default_tablespace: defaultTablespace || undefined,
          temporary_tablespace: temporaryTablespace || undefined,
          profile: profile || undefined,
          expire_password: expire,
          locked: locked || undefined,
        }
      : base;
    setSaving(true);
    const done = await apply(change);
    setSaving(false);
    if (!done) return;
    toast.success(`${finalName} erstellt`);
    onOpenChange(false);
    setName("");
    setPassword("");
    navigate({
      to: "/users/$name",
      params: { name: finalName },
      search: { profile: kind === "profile" || undefined },
    });
  };

  return (
    <Dialog busy={saving} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{template ? `${template.name} klonen` : TITLE[kind]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="principal-name" className="text-xs">
              Name
            </Label>
            <Input
              id="principal-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !user) create();
              }}
              className="font-mono"
            />
          </div>
          {user && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="principal-new-password" className="text-xs">
                  Passwort
                </Label>
                <Input
                  id="principal-new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {choices.map((choice) => (
                  <div key={choice.id} className="space-y-1.5">
                    <Label className="text-xs">{choice.label}</Label>
                    <Select value={choice.value} onValueChange={choice.set}>
                      <SelectTrigger
                        size="sm"
                        className="w-full font-mono text-xs"
                        aria-label={choice.label}
                      >
                        <SelectValue placeholder="Standard" />
                      </SelectTrigger>
                      <SelectContent>
                        {[...new Set([...choice.options, choice.value].filter(Boolean))].map(
                          (option) => (
                            <SelectItem key={option} value={option} className="font-mono text-xs">
                              {option}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="principal-new-expire" className="text-[13px]">
                  Passwort beim ersten Login ändern
                </Label>
                <Switch
                  id="principal-new-expire"
                  size="sm"
                  checked={expire}
                  onCheckedChange={setExpire}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="principal-new-locked" className="text-[13px]">
                  Gesperrt
                </Label>
                <Switch
                  id="principal-new-locked"
                  size="sm"
                  checked={locked}
                  onCheckedChange={setLocked}
                />
              </div>
            </>
          )}
          {template?.object_privileges_truncated && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Nur die ersten {template.object_privileges.length} Objektrechte werden übernommen.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button disabled={!ready || saving} onClick={create}>
            {saving && <Spinner />}
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
