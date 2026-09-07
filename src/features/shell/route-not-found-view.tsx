import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowLeft, House, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function RouteNotFoundView() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="connection-empty relative grid min-h-0 w-full flex-1 place-items-center overflow-y-auto p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="shell-bezel relative w-full max-w-md p-8 text-center"
      >
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border bg-muted text-muted-foreground">
          <SearchX className="size-5" />
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Badge variant="secondary">404</Badge>
          <span className="font-mono text-[11px] text-muted-foreground">NOT_FOUND</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Seite nicht gefunden</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Diese Route existiert nicht
          {pathname ? (
            <>
              {" "}
              – <span className="font-mono text-xs break-all">{pathname}</span>
            </>
          ) : (
            "."
          )}
          . Möglicherweise wurde ein Tab oder Lesezeichen ungültig.
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
