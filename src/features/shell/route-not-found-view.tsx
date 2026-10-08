import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, House, SearchX } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

export function RouteNotFoundView() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="relative grid min-h-0 w-full flex-1 place-items-center overflow-y-auto bg-background p-6">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="shell-bezel relative w-full max-w-md p-8 text-center"
      >
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border bg-muted text-muted-foreground">
          <SearchX className="size-5" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Ansicht nicht gefunden</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Diese Ansicht ist nicht mehr verfügbar
          {pathname ? (
            <>
              {" "}
              : <span className="font-mono text-xs break-all">{pathname}</span>
            </>
          ) : (
            ""
          )}
          . Öffne deinen Arbeitsplatz oder gehe zur vorherigen Ansicht zurück.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link to="/">
              <House className="size-4" data-icon="inline-start" />
              Zur Startseite
            </Link>
          </Button>
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="size-4" data-icon="inline-start" />
            Zurück
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
