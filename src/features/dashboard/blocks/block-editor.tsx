import { ImageUpIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  BLOCK_LABEL,
  type DashboardPage,
  type DashboardVariable,
  isHttpsUrl,
  MAX_BLOCK_TEXT,
  MAX_IMAGE_BYTES,
  readImageFile,
  variableToken,
  type WidgetBlock,
} from "@/lib/dashboards";
import { BlockChoice } from "./block-choice";
import { BlockField } from "./block-field";

const ALIGN: [NonNullable<WidgetBlock["align"]>, string][] = [
  ["left", "Links"],
  ["center", "Mitte"],
  ["right", "Rechts"],
];

const VARIANT: [NonNullable<WidgetBlock["variant"]>, string][] = [
  ["plain", "Ohne Hintergrund"],
  ["card", "Als Karte"],
  ["accent", "Akzentfarbe"],
];

const URL_TARGET = "__url__";

export function BlockEditor({
  block,
  pages,
  variables,
  onSave,
  onClose,
}: {
  block: WidgetBlock;
  pages: DashboardPage[];
  variables: DashboardVariable[];
  onSave: (block: WidgetBlock) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<WidgetBlock>(block);
  const fileRef = useRef<HTMLInputElement>(null);
  const textId = useId();
  const patch = (next: Partial<WidgetBlock>) => setDraft((current) => ({ ...current, ...next }));
  const hrefInvalid = Boolean(draft.href) && !isHttpsUrl(draft.href);
  const target = draft.page ?? URL_TARGET;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{BLOCK_LABEL[draft.type]} bearbeiten</DialogTitle>
          <DialogDescription>
            Änderungen erscheinen direkt auf der Dashboard-Seite.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {draft.type === "text" && (
            <div className="grid gap-1.5 text-xs font-medium">
              <label htmlFor={textId}>Inhalt (Markdown)</label>
              <Textarea
                id={textId}
                value={draft.text ?? ""}
                maxLength={MAX_BLOCK_TEXT}
                onChange={(e) => patch({ text: e.target.value })}
                className="min-h-40 font-mono text-xs"
                placeholder={"# Überschrift\nText mit **fett** und Listen:\n- Punkt"}
              />
              {variables.length > 0 && (
                <span className="font-normal text-muted-foreground">
                  Filterwerte einfügen: {variables.map((v) => variableToken(v.name)).join(", ")}
                </span>
              )}
            </div>
          )}
          {(draft.type === "link" || draft.type === "divider" || draft.type === "image") && (
            <BlockField
              label={
                draft.type === "link"
                  ? "Beschriftung"
                  : draft.type === "image"
                    ? "Bildbeschreibung"
                    : "Abschnittstitel (optional)"
              }
            >
              <Input
                value={draft.text ?? ""}
                maxLength={120}
                onChange={(e) => patch({ text: e.target.value })}
                className="h-8 text-xs"
              />
            </BlockField>
          )}
          {draft.type === "image" && (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                  <ImageUpIcon /> Bild hochladen
                </Button>
                {draft.src && (
                  <Button size="sm" variant="ghost" onClick={() => patch({ src: undefined })}>
                    <Trash2Icon /> Entfernen
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">PNG, JPEG, WebP, GIF oder SVG</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    patch({ src: await readImageFile(file, MAX_IMAGE_BYTES) });
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Bild ungültig");
                  }
                }}
              />
              {draft.src && (
                <img
                  src={draft.src}
                  alt=""
                  className="h-24 w-full rounded-md border bg-muted/40 object-contain"
                />
              )}
              <BlockChoice
                label="Darstellung"
                value={draft.fit ?? "contain"}
                items={[
                  ["contain", "Ganz zeigen"],
                  ["cover", "Fläche füllen"],
                ]}
                onChange={(fit) => patch({ fit })}
              />
            </div>
          )}
          {draft.type === "link" && (
            <BlockChoice
              label="Ziel"
              value={target}
              items={[
                ...pages.map((page): [string, string] => [page.id, `Seite: ${page.name}`]),
                [URL_TARGET, "Webadresse (https)"],
              ]}
              onChange={(next) => patch({ page: next === URL_TARGET ? undefined : next })}
            />
          )}
          {(draft.type === "image" || (draft.type === "link" && !draft.page)) && (
            <BlockField
              label={draft.type === "image" ? "Link beim Klick (optional)" : "Webadresse"}
            >
              <Input
                value={draft.href ?? ""}
                aria-invalid={hrefInvalid}
                placeholder="https://"
                onChange={(e) => patch({ href: e.target.value.trim() || undefined })}
                className="h-8 text-xs"
              />
              {hrefInvalid && (
                <span className="font-normal text-destructive">
                  Nur https-Adressen sind erlaubt.
                </span>
              )}
            </BlockField>
          )}
          <div className="grid grid-cols-2 gap-3">
            {draft.type !== "image" && (
              <BlockChoice
                label="Ausrichtung"
                value={draft.align ?? (draft.type === "divider" ? "center" : "left")}
                items={ALIGN}
                onChange={(align) => patch({ align })}
              />
            )}
            {(draft.type === "text" || draft.type === "link") && (
              <BlockChoice
                label="Stil"
                value={draft.variant ?? (draft.type === "link" ? "accent" : "plain")}
                items={VARIANT}
                onChange={(variant) => patch({ variant })}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={hrefInvalid}
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
