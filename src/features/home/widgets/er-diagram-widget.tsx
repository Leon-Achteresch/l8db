import { Link } from "@tanstack/react-router";
import { ArrowRight, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErDiagramWidget() {
  return (
    <section className="h-full overflow-auto rounded-2xl bg-primary/[0.055] p-5">
      <Workflow className="mb-3 size-5 text-primary" />
      <h2 className="text-sm font-semibold">Das große Ganze sehen</h2>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Erkunde Tabellen und ihre Beziehungen im ER-Diagramm.
      </p>
      <Button variant="outline" size="sm" asChild className="mt-4 h-8 text-xs">
        <Link to="/er-diagram">
          Diagramm öffnen
          <ArrowRight className="size-3" />
        </Link>
      </Button>
    </section>
  );
}
