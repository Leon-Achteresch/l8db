import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { DefinitionDiffEditor } from "@/features/compare/definition-diff-editor";
import type { ChangedFile } from "@/lib/versioning/forge";
import { readFile } from "@/lib/versioning/repository";

export function VersioningPullFile({
  repo,
  file,
  base,
  head,
}: {
  repo: string;
  file: ChangedFile;
  base: string;
  head: string;
}) {
  const content = useQuery({
    queryKey: ["versioning-pull-file", repo, base, head, file.path],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => ({
      original: file.status === "A" ? "" : ((await readFile(repo, file.path, base)) ?? ""),
      modified: file.status === "D" ? "" : ((await readFile(repo, file.path, head)) ?? ""),
    }),
  });
  if (content.isLoading) return <Skeleton className="h-40 rounded-lg" />;
  if (content.error)
    return (
      <p role="alert" className="text-[11px] text-destructive">
        {String(content.error)}
      </p>
    );
  if (!content.data) return null;
  return (
    <div className="h-[320px] min-w-0 overflow-hidden rounded-lg bg-muted/20">
      <DefinitionDiffEditor
        original={content.data.original}
        modified={content.data.modified}
        onlyDifferences={false}
        readOnly
      />
    </div>
  );
}
