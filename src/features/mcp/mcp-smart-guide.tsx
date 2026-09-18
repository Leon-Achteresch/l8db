import { ArrowRight, CheckCircle2, Database, Sparkles, Terminal } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface McpSmartGuideProps {
  needsClient: boolean;
  needsConnection: boolean;
  onGoToClients: () => void;
  onGoToConnections: () => void;
}

export function McpSmartGuide({
  needsClient,
  needsConnection,
  onGoToClients,
  onGoToConnections,
}: McpSmartGuideProps) {
  if (!needsClient && !needsConnection) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25 }}
      className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Schnelleinrichtung empfohlen
              </h3>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-medium text-primary">
                Schritt für Schritt
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              {needsClient && needsConnection
                ? "Damit KI-Assistenten auf deine Daten zugreifen können, verbinde zuerst einen Client und gib mindestens eine Datenbank frei."
                : needsClient
                  ? "Deine Datenbank ist freigegeben! Jetzt fehlt nur noch die Registrierung in deinem KI-Tool (z. B. Cursor oder Claude)."
                  : "Deine KI-Tools sind gekoppelt! Gib jetzt mindestens eine Datenbankverbindung frei, damit Abfragen ausgeführt werden können."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Button
            variant={needsClient ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-8 text-xs font-medium",
              !needsClient && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
            )}
            onClick={onGoToClients}
          >
            {needsClient ? (
              <>
                <Terminal className="size-3.5" />
                1. KI-Client koppeln
                <ArrowRight className="size-3" />
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                Client bereit
              </>
            )}
          </Button>

          <Button
            variant={!needsClient && needsConnection ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-8 text-xs font-medium",
              !needsConnection && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
            )}
            onClick={onGoToConnections}
          >
            {needsConnection ? (
              <>
                <Database className="size-3.5" />
                2. Datenbank freigeben
                <ArrowRight className="size-3" />
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                Datenbank aktiv
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
