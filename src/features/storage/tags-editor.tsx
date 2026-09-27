import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { type ConfigTarget, s3DeleteConfig, s3GetConfig, s3PutConfig } from "@/lib/db";
import { parseTags, type S3Tag, tagsXml } from "@/lib/storage/s3";
import { KeyValueEditor } from "./key-value-editor";
import { errorText, useStorageConnection } from "./use-storage-connection";

export function TagsEditor({ target, readOnly }: { target: ConfigTarget; readOnly: boolean }) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const queryKey = [
    "s3",
    connection?.id,
    "config",
    target.bucket,
    target.key ?? null,
    target.versionId ?? null,
    "tagging",
  ];
  const tags = useQuery({ queryKey, queryFn: () => s3GetConfig(url, target, "tagging") });
  const [draft, setDraft] = useState<S3Tag[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tags.data !== undefined) setDraft(parseTags(tags.data));
  }, [tags.data]);

  if (tags.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Lade Tags…
      </div>
    );
  }
  if (tags.isError)
    return <p className="text-sm break-words text-destructive">{errorText(tags.error)}</p>;

  async function save() {
    setBusy(true);
    try {
      const clean = draft.filter((tag) => tag.key.trim());
      if (clean.length) await s3PutConfig(url, target, "tagging", tagsXml(clean));
      else await s3DeleteConfig(url, target, "tagging");
      await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });
      toast.success("Tags gespeichert");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        {target.key ? "Bis zu 10 Tags pro Objekt." : "Bucket-Tags, z. B. für Kostenstellen."}
      </p>
      <KeyValueEditor
        items={draft}
        onChange={setDraft}
        disabled={readOnly}
        addLabel="Tag hinzufügen"
      />
      {!readOnly && (
        <Button
          size="sm"
          className="justify-self-start"
          onClick={() => void save()}
          disabled={busy}
        >
          {busy ? <Spinner className="size-4" /> : null}
          Tags speichern
        </Button>
      )}
    </div>
  );
}
