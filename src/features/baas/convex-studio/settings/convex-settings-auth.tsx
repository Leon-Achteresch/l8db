import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { useConvexSettingsInfo } from "./use-convex-settings-info";

export function ConvexSettingsAuth({ deployment }: { deployment: ConvexStudioDeployment }) {
  const info = useConvexSettingsInfo(deployment);
  const providers = info.data?.authProviders ?? [];
  const components = info.data?.components ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold">Authentifizierung</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Provider aus convex/auth.config.ts des zuletzt deployten Codes. Änderungen erfolgen per
          Deploy.
        </p>
        {info.isPending ? (
          <p className="mt-3 text-xs text-muted-foreground">Wird geladen…</p>
        ) : providers.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Keine Auth-Provider konfiguriert.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {providers.map((provider) => (
              <li
                key={JSON.stringify(provider)}
                className="rounded-lg border bg-background/50 px-3 py-2 text-xs"
              >
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                  {Object.entries(provider).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="truncate font-mono" title={String(value)}>
                        {typeof value === "string" ? value : JSON.stringify(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold">Komponenten</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Installierte Convex-Komponenten. Die Root-App erscheint mit leerem Pfad.
        </p>
        {info.isPending ? (
          <p className="mt-3 text-xs text-muted-foreground">Wird geladen…</p>
        ) : components.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Keine Komponenten gefunden.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-lg border bg-background/50">
            {components.map((component) => (
              <li
                key={component.id ?? component.path}
                className="flex items-center gap-2 px-3 py-2 text-xs"
              >
                <span className="truncate font-mono">
                  {component.path || component.name || "Root-App"}
                </span>
                {component.state && (
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {component.state === "active" ? "Aktiv" : component.state}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
