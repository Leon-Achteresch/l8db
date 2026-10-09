import { ImageIcon } from "lucide-react";
import { isImageDataUrl, type WidgetBlock } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { openBlockUrl } from "./open-block-url";

export function ImageBlock({ block }: { block: WidgetBlock }) {
  if (!isImageDataUrl(block.src))
    return (
      <div className="grid h-full place-items-center rounded-md border border-dashed text-muted-foreground">
        <ImageIcon className="size-6" />
      </div>
    );
  const image = (
    <img
      src={block.src}
      alt={block.text ?? ""}
      draggable={false}
      className={cn(
        "dashboard-block-image h-full w-full",
        block.fit === "cover" ? "object-cover" : "object-contain",
      )}
    />
  );
  if (!block.href) return image;
  return (
    <button
      type="button"
      className="block h-full w-full cursor-pointer"
      title={block.href}
      onClick={() => openBlockUrl(block.href)}
    >
      {image}
    </button>
  );
}
