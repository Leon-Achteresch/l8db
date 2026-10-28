import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyWithToast } from "@/lib/clipboard";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { useConvexSettingsInfo } from "./use-convex-settings-info";

export function ConvexSettingsInfo({ deployment }: { deployment: ConvexStudioDeployment }) {
  const info = useConvexSettingsInfo(deployment);
  const data = info.data;
  const url = data?.cloudUrl ?? data?.url ?? deployment.url ?? "";
  const rows = [
    { label: "Deployment-URL", value: data?.url },
    { label: "HTTP-Actions (Site-URL)", value: data?.siteUrl },
    { label: "Kanonische Cloud-URL", value: data?.cloudUrl },
    { label: "Backend-Version", value: data?.version },
    { label: "Node-Version", value: data?.nodeVersion },
    { label: "Instanzname", value: data?.instanceName },
    { label: "Deployment-Art", value: data?.kind },
    { label: "Name", value: deployment.deploymentName || null },
  ];
  const snippet = deployment.selfHosted
    ? `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=<dein-admin-key>\nCONVEX_URL=${url}\nVITE_CONVEX_URL=${url}\nNEXT_PUBLIC_CONVEX_URL=${url}`
    : `CONVEX_DEPLOYMENT=${deployment.deploymentName}\nCONVEX_URL=${url}\nVITE_CONVEX_URL=${url}\nNEXT_PUBLIC_CONVEX_URL=${url}`;

  return (
    <>
      <section className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold">Deployment</h3>
        {info.isError ? (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {String(info.error)}
          </p>
        ) : (
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="mt-0.5 flex items-center gap-1 font-mono">
                  <span className="truncate" title={row.value ?? undefined}>
                    {info.isPending ? "…" : (row.value ?? "–")}
                  </span>
                  {row.value && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${row.label} kopieren`}
                      onClick={() => void copyWithToast(row.value ?? "", row.label)}
                    >
                      <Copy className="size-3" />
                    </Button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {data?.errors.map((error) => (
          <p key={error} role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ))}
      </section>
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Verbindung für Apps</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={!url}
            onClick={() => void copyWithToast(snippet, "Konfiguration")}
          >
            <Copy className="size-3.5" /> Kopieren
          </Button>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-background/50 p-3 font-mono text-[11px]">
          {snippet}
        </pre>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {deployment.selfHosted
            ? "Den Admin-Key erzeugst du auf dem Server mit ./generate_admin_key.sh. l8db zeigt den gespeicherten Key nicht an."
            : "Für CI-Deployments erzeugst du im Convex-Dashboard unter Settings → Deploy Keys einen CONVEX_DEPLOY_KEY. l8db gibt keine Schlüssel aus."}
        </p>
      </section>
    </>
  );
}
