import { useInfiniteQuery } from "@tanstack/react-query";
import { s3ListObjects, s3ListObjectVersions, s3SearchObjects } from "@/lib/db";
import { basename } from "@/lib/storage/s3";
import { useStorageConnection } from "./use-storage-connection";

export type BrowserMode = "objects" | "versions" | "search";

export interface BrowserRow {
  id: string;
  kind: "folder" | "object";
  key: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  storageClass: string | null;
  etag: string | null;
  versionId?: string;
  isLatest?: boolean;
  deleteMarker?: boolean;
}

interface Page {
  rows: BrowserRow[];
  next: { token?: string; keyMarker?: string; versionMarker?: string } | null;
  truncated: boolean;
}

function folderRow(prefix: string): BrowserRow {
  return {
    id: `folder:${prefix}`,
    kind: "folder",
    key: prefix,
    name: basename(prefix),
    size: null,
    lastModified: null,
    storageClass: null,
    etag: null,
  };
}

export function useObjectListing(
  bucket: string,
  prefix: string,
  mode: BrowserMode,
  search: string,
) {
  const { connection, url } = useStorageConnection();
  return useInfiniteQuery({
    queryKey: [
      "s3",
      connection?.id,
      "objects",
      bucket,
      prefix,
      mode,
      mode === "search" ? search : "",
    ],
    enabled: Boolean(url) && (mode !== "search" || Boolean(search.trim())),
    initialPageParam: null as Page["next"],
    getNextPageParam: (last: Page) => last.next ?? undefined,
    queryFn: async ({ pageParam }): Promise<Page> => {
      if (mode === "search") {
        const result = await s3SearchObjects(url, bucket, prefix, search, 1000);
        return {
          rows: result.objects.map((o) => ({
            id: `object:${o.key}`,
            kind: "object",
            key: o.key,
            name: o.key.slice(prefix.length),
            size: o.size,
            lastModified: o.last_modified,
            storageClass: o.storage_class,
            etag: o.etag,
          })),
          next: null,
          truncated: result.truncated,
        };
      }
      if (mode === "versions") {
        const page = await s3ListObjectVersions(url, bucket, prefix, {
          keyMarker: pageParam?.keyMarker,
          versionMarker: pageParam?.versionMarker,
        });
        return {
          rows: [
            ...(pageParam ? [] : page.prefixes.map(folderRow)),
            ...page.versions.map((v) => ({
              id: `version:${v.key}:${v.version_id}`,
              kind: "object" as const,
              key: v.key,
              name: basename(v.key),
              size: v.delete_marker ? null : v.size,
              lastModified: v.last_modified,
              storageClass: v.storage_class,
              etag: v.etag,
              versionId: v.version_id,
              isLatest: v.is_latest,
              deleteMarker: v.delete_marker,
            })),
          ],
          next: page.truncated
            ? {
                keyMarker: page.next_key_marker ?? undefined,
                versionMarker: page.next_version_marker ?? undefined,
              }
            : null,
          truncated: page.truncated,
        };
      }
      const page = await s3ListObjects(url, bucket, prefix, {
        continuationToken: pageParam?.token,
      });
      return {
        rows: [
          ...page.prefixes.map(folderRow),
          ...page.objects
            .filter((o) => o.key !== prefix)
            .map((o) => ({
              id: `object:${o.key}`,
              kind: "object" as const,
              key: o.key,
              name: basename(o.key),
              size: o.size,
              lastModified: o.last_modified,
              storageClass: o.storage_class,
              etag: o.etag,
            })),
        ],
        next: page.next_token ? { token: page.next_token } : null,
        truncated: page.truncated,
      };
    },
  });
}
