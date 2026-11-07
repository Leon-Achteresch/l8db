import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const TEXT = {
  checkout: {
    title: "Checkout-Link erstellt",
    description:
      "Stripe Checkout zeigt Kartenfelder ausschließlich auf der Stripe-Seite. Der Link läuft nach 24 Stunden ab.",
  },
  portal: {
    title: "Kundenportal-Link erstellt",
    description:
      "Der Link öffnet das Kundenkonto ohne weitere Anmeldung. Nur an diesen Kunden weitergeben; er läuft nach kurzer Zeit ab.",
  },
};

export function PaymentsLinkResult({
  link,
  onClose,
}: {
  link: { url: string; kind: "checkout" | "portal" } | null;
  onClose: () => void;
}) {
  const text = link ? TEXT[link.kind] : TEXT.checkout;
  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <Input readOnly value={link?.url ?? ""} aria-label="Link" className="font-mono text-xs" />
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              link &&
              navigator.clipboard
                .writeText(link.url)
                .then(() => toast.success("Link kopiert"))
                .catch(() => toast.error("Kopieren nicht möglich"))
            }
          >
            <Copy className="size-3.5" /> Kopieren
          </Button>
          <Button
            size="sm"
            onClick={() =>
              link &&
              openUrl(link.url).catch(() => toast.error("Link konnte nicht geöffnet werden"))
            }
          >
            <ExternalLink className="size-3.5" /> Öffnen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
