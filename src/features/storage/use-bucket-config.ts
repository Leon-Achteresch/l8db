import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { type BucketResource, s3DeleteConfig, s3GetConfig, s3PutConfig } from "@/lib/db";
import { errorText, useStorageConnection } from "./use-storage-connection";

export function isUnsupported(error: unknown): boolean {
  return /NotImplemented|not implemented|MethodNotAllowed|UnsupportedOperation/i.test(
    errorText(error),
  );
}

export function useBucketConfig(bucket: string, resource: BucketResource) {
  const { connection, url, readOnly } = useStorageConnection();
  const queryClient = useQueryClient();
  const queryKey = ["s3", connection?.id, "config", bucket, null, null, resource];
  const query = useQuery({
    queryKey,
    queryFn: () => s3GetConfig(url, { bucket }, resource),
    retry: false,
  });
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id, "config", bucket] });
      return true;
    } catch (error) {
      if (isUnsupported(error))
        toast.error("Wird von diesem Server nicht unterstützt.", { description: errorText(error) });
      else toast.error(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.isError ? query.error : null,
    unsupported: query.isError && isUnsupported(query.error),
    busy,
    readOnly,
    save: (body: string, message = "Gespeichert") =>
      run(() => s3PutConfig(url, { bucket }, resource, body), message),
    remove: (message = "Entfernt") => run(() => s3DeleteConfig(url, { bucket }, resource), message),
  };
}
