import { Badge } from "@/components/ui/badge";
import type { ConvexStudioComponent, ConvexStudioModule } from "@/lib/db/convex-studio-functions";

export function ConvexComponentsList({
  components,
  modules,
}: {
  components: ConvexStudioComponent[];
  modules: ConvexStudioModule[];
}) {
  return (
    <div className="overflow-auto rounded-xl border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Pfad</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">HTTP-Präfix</th>
            <th className="px-3 py-2 font-medium">Funktionen</th>
            <th className="px-3 py-2 font-medium">Argumente</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {components.map((component) => (
            <tr key={component.id}>
              <td className="px-3 py-2 font-mono">{component.path || "(App)"}</td>
              <td className="px-3 py-2">{component.name ?? "–"}</td>
              <td className="px-3 py-2">
                <Badge variant={component.state === "active" ? "secondary" : "outline"}>
                  {component.state === "active" ? "Aktiv" : component.state}
                </Badge>
              </td>
              <td className="px-3 py-2 font-mono">{component.httpPrefix ?? "–"}</td>
              <td className="px-3 py-2 tabular-nums">
                {modules
                  .filter((module) => module.componentPath === component.path)
                  .reduce((sum, module) => sum + module.functions.length, 0)}
              </td>
              <td
                className="max-w-64 truncate px-3 py-2 font-mono"
                title={JSON.stringify(component.args)}
              >
                {JSON.stringify(component.args ?? {})}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
