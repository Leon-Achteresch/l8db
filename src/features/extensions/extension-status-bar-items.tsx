import { useExtensionHost, useExtensionStatusBar } from "@/lib/extensions/react-context";
import { cn } from "@/lib/utils";

export function ExtensionStatusBarItems({ side }: { side: "left" | "right" }) {
  const items = useExtensionStatusBar().filter((item) => item.alignment === side);
  const host = useExtensionHost();
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <button
          key={`${item.extensionId}:${item.itemId}`}
          type="button"
          title={item.update.tooltip ?? item.itemId}
          onClick={
            item.update.command
              ? () => void host.executeCommand(item.update.command!).catch(() => undefined)
              : undefined
          }
          className={cn(
            "truncate rounded px-1 hover:text-foreground",
            item.update.command && "cursor-pointer",
            item.update.background === "error" && "text-destructive",
            item.update.background === "warning" && "text-amber-500",
            item.update.background === "info" && "text-sky-500",
          )}
        >
          {item.update.text}
        </button>
      ))}
    </>
  );
}
