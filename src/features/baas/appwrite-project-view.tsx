import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FunctionSquare, Globe2, Layout, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type AppwriteProfile, appwriteFunctions, appwriteSites, appwriteUsers } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { AppwriteDatabasesView } from "./appwrite-databases-view";
import { AppwriteFunctionActions } from "./appwrite-function-actions";
import { AppwriteResourceCard } from "./appwrite-resource-card";
import { AppwriteStorageView } from "./appwrite-storage-view";
import { AppwriteUserActions } from "./appwrite-user-actions";
import { AppwriteUserCreateView } from "./appwrite-user-create-view";

export function AppwriteProjectView({ profile }: { profile: AppwriteProfile }) {
  const functionDetails = useNewFeatureVisibility<HTMLDivElement>("baas.appwrite.function-details");
  const siteDetails = useNewFeatureVisibility<HTMLDivElement>("baas.appwrite.site-details");
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
        <div data-baas-section="storage" className="scroll-mt-6">
          <AppwriteStorageView id={profile.id} />
        </div>
        <div data-baas-section="database" className="scroll-mt-6">
          <AppwriteDatabasesView id={profile.id} />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <AppwriteResourceCard
          id={profile.id}
          kind="functions"
          title="Functions"
          icon={<FunctionSquare className="size-4 text-muted-foreground" />}
          load={appwriteFunctions}
          detail={(item) =>
            [item.runtime, item.latest_deployment_status].filter(Boolean).join(" · ") || item.id
          }
          detailsRef={functionDetails.ref}
          detailsNew={functionDetails.isNew}
          renderActions={(item, index) => (
            <AppwriteFunctionActions id={profile.id} item={item} showNew={index === 0} />
          )}
          renderDetails={(item) => (
            <dl className="grid gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground">ID</dt>
                <dd className="mt-0.5 break-all font-mono">{item.id}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-0.5">
                    {item.enabled == null ? "Unbekannt" : item.enabled ? "Aktiv" : "Inaktiv"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Konfiguration</dt>
                  <dd className="mt-0.5">
                    {item.live == null ? "Unbekannt" : item.live ? "Aktuell" : "Abweichend"}
                  </dd>
                </div>
              </div>
              <div>
                <dt className="text-muted-foreground">Laufzeit · Deployment</dt>
                <dd className="mt-0.5 break-all">
                  {item.runtime ?? "Unbekannt"} · {item.latest_deployment_status ?? "Kein Status"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Aktives Deployment</dt>
                <dd className="mt-0.5 break-all font-mono">{item.deployment_id || "Keines"}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-muted-foreground">Zeitlimit</dt>
                  <dd className="mt-0.5">
                    {item.timeout == null ? "Nicht angegeben" : `${item.timeout} s`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Zeitplan</dt>
                  <dd className="mt-0.5 break-all font-mono">{item.schedule || "Keiner"}</dd>
                </div>
              </div>
              <div>
                <dt className="text-muted-foreground">Trigger-Ereignisse</dt>
                <dd className="mt-0.5 max-h-28 overflow-auto break-all font-mono">
                  {item.events?.length ? item.events.join(", ") : "Keine"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ausführungsrechte</dt>
                <dd className="mt-0.5 max-h-28 overflow-auto break-all font-mono">
                  {item.execute?.length ? item.execute.join(", ") : "Keine"}
                </dd>
              </div>
            </dl>
          )}
        />
        <AppwriteResourceCard
          id={profile.id}
          kind="users"
          title="Auth-Nutzer"
          icon={<Users className="size-4 text-muted-foreground" />}
          load={appwriteUsers}
          detail={(item) => item.email || item.id}
          headerAction={<AppwriteUserCreateView id={profile.id} />}
          renderActions={(item) => (
            <AppwriteUserActions key={`${item.id}:${item.email}`} id={profile.id} user={item} />
          )}
        />
        <AppwriteResourceCard
          id={profile.id}
          kind="sites"
          title="Sites"
          icon={<Layout className="size-4 text-muted-foreground" />}
          load={appwriteSites}
          detail={(item) =>
            [item.framework, item.latest_deployment_status].filter(Boolean).join(" · ") || item.id
          }
          detailsRef={siteDetails.ref}
          detailsNew={siteDetails.isNew}
          renderDetails={(item) => (
            <dl className="grid gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground">ID</dt>
                <dd className="mt-0.5 break-all font-mono">{item.id}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-0.5">
                    {item.enabled == null ? "Unbekannt" : item.enabled ? "Aktiv" : "Inaktiv"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Konfiguration</dt>
                  <dd className="mt-0.5">
                    {item.live == null ? "Unbekannt" : item.live ? "Aktuell" : "Abweichend"}
                  </dd>
                </div>
              </div>
              <div>
                <dt className="text-muted-foreground">Framework · Deployment</dt>
                <dd className="mt-0.5 break-all">
                  {item.framework ?? "Unbekannt"} · {item.latest_deployment_status ?? "Kein Status"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Aktives Deployment</dt>
                <dd className="mt-0.5 break-all font-mono">{item.deployment_id || "Keines"}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-muted-foreground">Build-Laufzeit</dt>
                  <dd className="mt-0.5 break-all">{item.build_runtime || "Nicht angegeben"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Adapter</dt>
                  <dd className="mt-0.5 break-all">{item.adapter || "Nicht angegeben"}</dd>
                </div>
              </div>
              <div>
                <dt className="text-muted-foreground">Ausgabeordner</dt>
                <dd className="mt-0.5 break-all font-mono">
                  {item.output_directory || "Nicht angegeben"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Zeitlimit</dt>
                <dd className="mt-0.5">
                  {item.timeout == null ? "Nicht angegeben" : `${item.timeout} s`}
                </dd>
              </div>
            </dl>
          )}
        />
      </div>
    </div>
  );
}
