import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabaseEdgeFunctionDeploy } from "@/lib/db/supabase-studio-edge";
import { FUNCTION_SLUG } from "./supabase-functions-store";

export interface SupabaseFunctionDeployTarget {
  slug: string;
  name: string;
  verifyJwt: boolean;
}

export function SupabaseFunctionDeployDialog({
  reference,
  target,
  onClose,
  onDeployed,
}: {
  reference: string;
  target: SupabaseFunctionDeployTarget | null;
  onClose: () => void;
  onDeployed: (slug: string) => void;
}) {
  const queryClient = useQueryClient();
  const existing = Boolean(target?.slug);
  const [slug, setSlug] = useState(target?.slug ?? "");
  const [name, setName] = useState(target?.name ?? "");
  const [entrypoint, setEntrypoint] = useState("index.ts");
  const [importMap, setImportMap] = useState("");
  const [verifyJwt, setVerifyJwt] = useState(target?.verifyJwt ?? true);
  const deploy = useMutation({
    mutationFn: () =>
      supabaseEdgeFunctionDeploy(
        reference,
        slug.trim(),
        name.trim(),
        entrypoint.trim(),
        importMap.trim() || null,
        verifyJwt,
      ),
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: ["supabase", reference, "functions"] });
      await queryClient.invalidateQueries({
        queryKey: ["supabase", reference, "function", slug.trim()],
      });
      await queryClient.invalidateQueries({
        queryKey: ["supabase", reference, "function-source", slug.trim()],
      });
      onDeployed(slug.trim());
      onClose();
    },
  });
  const valid = FUNCTION_SLUG.test(slug.trim()) && entrypoint.trim().length > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !deploy.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existing ? `${target?.slug} neu deployen` : "Edge Function deployen"}
          </DialogTitle>
          <DialogDescription>
            Wähle den Ordner mit dem Quellcode der Funktion. Alle Dateien außer versteckten Ordnern
            und node_modules werden hochgeladen (höchstens 1000 Dateien, 20 MB).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edge-deploy-slug">Slug</Label>
            <Input
              id="edge-deploy-slug"
              value={slug}
              disabled={existing}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="hello-world"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edge-deploy-name">Name</Label>
            <Input
              id="edge-deploy-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Standard: Slug"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edge-deploy-entry">Einstiegspunkt</Label>
              <Input
                id="edge-deploy-entry"
                value={entrypoint}
                onChange={(event) => setEntrypoint(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edge-deploy-import-map">Import Map (optional)</Label>
              <Input
                id="edge-deploy-import-map"
                value={importMap}
                onChange={(event) => setImportMap(event.target.value)}
                placeholder="deno.json"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch id="edge-deploy-jwt" checked={verifyJwt} onCheckedChange={setVerifyJwt} />
            <Label htmlFor="edge-deploy-jwt">JWT prüfen (verify_jwt)</Label>
          </div>
          {deploy.isError && (
            <p role="alert" className="text-xs text-destructive">
              {String(deploy.error)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={deploy.isPending} onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!valid || deploy.isPending} onClick={() => deploy.mutate()}>
            <FolderUp className="size-4" />
            {deploy.isPending ? "Wird deployt…" : "Ordner wählen und deployen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
