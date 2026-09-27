import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FunctionSquare, Globe2, Layout, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type AppwriteProfile, appwriteFunctions, appwriteSites, appwriteUsers } from "@/lib/db";
import { AppwriteDatabasesView } from "./appwrite-databases-view";
import { AppwriteResourceCard } from "./appwrite-resource-card";
import { AppwriteStorageView } from "./appwrite-storage-view";

export function AppwriteProjectView({ profile }: { profile: AppwriteProfile }) {
  const endpoint = new URL(profile.endpoint);
  const dashboard = endpoint.hostname.endsWith(".cloud.appwrite.io")
    ? `https://appwrite.io/projects/${profile.project_id}`
    : endpoint.origin;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{profile.name}</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{profile.project_id}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
              <Globe2 className="size-3.5" /> {profile.region ?? endpoint.host}
            </div>
            <Button variant="outline" size="sm" onClick={() => void openUrl(dashboard)}>
              Appwrite-Dashboard <ExternalLink className="size-3.5" />
            </Button>
          </div>
        </div>
        <p className="mt-4 break-all text-xs text-muted-foreground">{profile.endpoint}</p>
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <AppwriteStorageView id={profile.id} />
        <AppwriteDatabasesView id={profile.id} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <AppwriteResourceCard
          id={profile.id}
          kind="functions"
          title="Functions"
          icon={<FunctionSquare className="size-4 text-muted-foreground" />}
          load={appwriteFunctions}
          detail={(item) => item.id}
        />
        <AppwriteResourceCard
          id={profile.id}
          kind="users"
          title="Auth-Nutzer"
          icon={<Users className="size-4 text-muted-foreground" />}
          load={appwriteUsers}
          detail={(item) => item.email || item.id}
        />
        <AppwriteResourceCard
          id={profile.id}
          kind="sites"
          title="Sites"
          icon={<Layout className="size-4 text-muted-foreground" />}
          load={appwriteSites}
          detail={(item) => item.id}
        />
      </div>
    </div>
  );
}
