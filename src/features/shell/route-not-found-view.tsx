import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, House } from "lucide-react";
import { motion } from "motion/react";
import { Illustration } from "@/components/illustration";
import { Button } from "@/components/ui/button";

export function RouteNotFoundView() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="connection-empty relative grid min-h-0 w-full flex-1 place-items-center overflow-y-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex w-full max-w-md flex-col items-center text-center"
      >
        <Illustration name="not-found" className="w-52" />
        <span className="mt-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          404
        </span>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Seite nicht gefunden</h1>
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
          .
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
