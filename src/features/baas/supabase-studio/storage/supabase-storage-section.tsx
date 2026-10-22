import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import type { SupabaseBucket } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseStorageBrowser } from "./supabase-storage-browser";
import { SupabaseStorageBucketHeader } from "./supabase-storage-bucket-header";
import { SupabaseStorageBucketList } from "./supabase-storage-bucket-list";

const route = getRouteApi("/baas");

export function SupabaseStorageSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.storage");
  const search = route.useSearch();
  const navigate = useNavigate();
  const [bucket, setBucket] = useState<SupabaseBucket | null>(null);
  const canManage = capabilities.service_key;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 ref={feature.ref} className="flex items-center gap-2 text-lg font-semibold">
            Storage {feature.isNew && <NewBadge />}
          </h2>
          <p className="text-xs text-muted-foreground">
            {canManage
              ? "Buckets und Dateien verwalten."
              : "Publishable/anon Key: Zugriff nur, soweit Storage-Richtlinien es erlauben. Bucket-Verwaltung benötigt einen Secret oder service_role Key."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!capabilities.sql}
          title={capabilities.sql ? undefined : "Richtlinien benötigen SQL-Zugriff."}
          onClick={() => void navigate({ to: "/baas", search: { ...search, studio: "policies" } })}
        >
          <ShieldCheck className="size-3.5" /> Storage-Richtlinien
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SupabaseStorageBucketList
          reference={project.reference}
          selectedId={bucket?.id ?? null}
          canManage={canManage}
          onSelect={setBucket}
        />
        <div className="min-w-0 space-y-4">
          {bucket ? (
            <>
              <SupabaseStorageBucketHeader
                reference={project.reference}
                bucket={bucket}
                canManage={canManage}
                onChanged={setBucket}
                onDeleted={() => setBucket(null)}
              />
              <SupabaseStorageBrowser
                key={bucket.id}
                reference={project.reference}
                bucket={bucket}
              />
            </>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
              Bucket links auswählen, um Dateien zu sehen.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
