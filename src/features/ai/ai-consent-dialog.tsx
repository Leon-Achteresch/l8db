import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { answerAiConsent, useAiAccess } from "@/lib/ai/access";
import { AI_PROVIDERS } from "@/lib/ai/store";

export function AiConsentDialog() {
  const pending = useAiAccess((state) => state.pending);
  const name = AI_PROVIDERS.find((entry) => entry.id === pending?.provider)?.name;
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) answerAiConsent(false);
      }}
    >
      <AlertDialogContent size="sm" data-testid="ai-consent">
        <AlertDialogHeader>
          <AlertDialogTitle>{name ?? pending?.provider} freigeben?</AlertDialogTitle>
          <AlertDialogDescription>
            Schema, SQL und Kontext gehen an den Anbieter.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answerAiConsent(false)}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={() => answerAiConsent(true)}>Erlauben</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
