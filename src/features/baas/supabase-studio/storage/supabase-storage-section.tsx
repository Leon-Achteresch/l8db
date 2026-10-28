import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SupabaseBucket } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasSidebarPortal } from "../../baas-sidebar-portal";
import { SupabaseSectionHeader } from "../supabase-section-header";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseStorageBrowser } from "./supabase-storage-browser";
import { SupabaseStorageBucketHeader } from "./supabase-storage-bucket-header";
import { SupabaseStorageBucketList } from "./supabase-storage-bucket-list";
import { SupabaseStorageBucketOverview } from "./supabase-storage-bucket-overview";

const route = getRouteApi("/baas");

export function SupabaseStorageSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.storage");
  const search = route.useSearch();
  const navigate = useNavigate();
  const [bucket, setBucket] = useState<SupabaseBucket | null>(null);
  const canManage = capabilities.service_key;

  return (
    <div className="space-y-5">
      <SupabaseSectionHeader
        title="Storage"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description={
          canManage
            ? "Buckets und Dateien verwalten."
            : "Publishable/anon Key: Zugriff nur, soweit Storage-Richtlinien es erlauben. Bucket-Verwaltung benötigt einen Secret oder service_role Key."
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={!capabilities.sql}
            title={capabilities.sql ? undefined : "Richtlinien benötigen SQL-Zugriff."}
            onClick={() =>
              void navigate({ to: "/baas", search: { ...search, studio: "policies" } })
            }
          >
            <ShieldCheck className="size-3.5" /> Storage-Richtlinien
          </Button>
        }
      />
      <BaasSidebarPortal>
        <SupabaseStorageBucketList
          reference={project.reference}
          selectedId={bucket?.id ?? null}
          canManage={canManage}
          onSelect={setBucket}
        />
      </BaasSidebarPortal>
      <div>
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
            <SupabaseStorageBucketOverview reference={project.reference} onSelect={setBucket} />
          )}
        </div>
      </div>
    </div>
  );
}
