import { ArrowRight, PlugZap, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BaasConnectForm } from "@/features/baas/baas-connect-form";
import { BAAS_PROVIDERS, type BaasProvider } from "@/features/baas/baas-providers";
import { serverLabel } from "@/lib/connection-groups";
import { ConnectionDetailsStep } from "./connection-editor/details-step";
import { ConnectionProviderStep } from "./connection-editor/provider-step";
import type { ConnectionEditorProps } from "./connection-editor/types";
import { useConnectionEditor } from "./connection-editor/use-connection-editor";
import { SetupStepper } from "./setup-stepper";

export function ConnectionEditor({
  connection,
  template,
  onSaved,
  onCancel,
}: ConnectionEditorProps) {
  const editor = useConnectionEditor({ connection, template, onSaved });
  const {
    activeInfo,
    busy,
    guided,
    info,
    pasteConnectionString,
    provider,
    providers,
    reduce,
    save,
    selectProvider,
    setResult,
    setStep,
    step,
    test,
  } = editor;
  const [baas, setBaas] = useState<BaasProvider | null>(null);
  const baasName = BAAS_PROVIDERS.find((item) => item.id === baas)?.name;

  return (
    <section
      data-tour="connection-editor"
      className="shell-bezel flex max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            {connection
              ? connection.name
              : template
                ? `Weitere Verbindung auf ${serverLabel(template)}`
                : "Neue Verbindung"}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {baasName ?? (step === 1 ? "Welche Datenbank willst du öffnen?" : activeInfo.name)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Editor schließen"
          disabled={busy}
          onClick={onCancel}
        >
          <X className="size-4" />
        </Button>
      </header>
      {baas ? (
        <BaasConnectForm
          key={baas}
          provider={baas}
          onBack={() => setBaas(null)}
          onSaved={onSaved}
          onDirectDatabase={
            baas === "supabase"
              ? () => {
                  setBaas(null);
                  selectProvider("supabase");
                  setStep(2);
                }
              : undefined
          }
        />
      ) : (
        <>
          {guided && (
            <div className="shrink-0 px-4 pb-3">
              <SetupStepper step={step} onStep={(next) => setStep(next)} />
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (step === 2) void save();
            }}
            onChange={() => setResult({ status: "idle" })}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <fieldset
              disabled={busy}
              className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 disabled:opacity-70"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={reduce ? false : { opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? undefined : { opacity: 0, x: -16 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="pb-2"
                >
                  {step === 1 && (
                    <ConnectionProviderStep
                      providers={providers}
                      provider={provider}
                      selectProvider={selectProvider}
                      pasteConnectionString={pasteConnectionString}
                      selectBaas={setBaas}
                    />
                  )}
                  {step === 2 && <ConnectionDetailsStep editor={editor} connection={connection} />}
                </motion.div>
              </AnimatePresence>
            </fieldset>
            <footer
              data-tour="connection-save"
              className="flex shrink-0 items-center justify-between gap-2 border-t bg-card/50 px-4 py-3"
            >
              <Button
                type="button"
                variant="ghost"
                disabled={busy || step === 1 || !guided}
                onClick={() => setStep(1)}
              >
                Zurück
              </Button>
              {step === 1 ? (
                <Button
                  type="button"
                  disabled={busy || !info.driver_status.available}
                  onClick={() => {
                    requestAnimationFrame(() => setStep(2));
                  }}
                >
                  Weiter
                  <ArrowRight className="size-3.5" />
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void test()}
                  >
                    <PlugZap className="size-4" />
                    Testen
                  </Button>
                  <Button type="submit" disabled={busy} className="h-11 min-w-36">
                    Verbindung speichern
                  </Button>
                </div>
              )}
            </footer>
          </form>
        </>
      )}
    </section>
  );
}
