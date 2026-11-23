import { CheckIcon, EyeIcon, EyeOffIcon, Loader2Icon, PuzzleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useExtensionHost, useExtensionSnapshot } from "@/lib/extensions/react-context";

const ICONS: Record<string, typeof PuzzleIcon> = {
  eye: EyeIcon,
  "eye-off": EyeOffIcon,
};

export function EditorExtensionActions({
  editorId,
  size = "xs",
}: {
  editorId: string;
  size?: "xs" | "sm";
}) {
  const host = useExtensionHost();
  const [running, setRunning] = useState<string | null>(null);
  const actions = useExtensionSnapshot((manager) =>
    manager.editors.has(editorId)
      ? manager.commands.menusFor("editor/toolbar").flatMap((menu) => {
          const command = manager.commands.list().find((item) => item.id === menu.command);
          return command && manager.registry.get(menu.owner).enabled
            ? [{ ...command, checked: manager.editors.isChecked(editorId, command.id) }]
            : [];
        })
      : [],
  );

  const run = async (command: string) => {
    setRunning(command);
    try {
      await host.executeEditorCommand(command, editorId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(null);
    }
  };

  return actions.map((action) => {
    const Icon =
      running === action.id
        ? Loader2Icon
        : action.checked
          ? CheckIcon
          : (ICONS[action.icon ?? ""] ?? PuzzleIcon);
    return (
      <Button
        key={action.id}
        size={size}
        variant={action.checked ? "secondary" : "ghost"}
        className={size === "sm" ? "h-7 shrink-0 gap-1.5 px-2 text-xs" : "shrink-0"}
        aria-pressed={action.checked}
        data-extension-command={action.id}
        disabled={running !== null}
        onClick={() => void run(action.id)}
      >
        <Icon data-icon="inline-start" className={running === action.id ? "animate-spin" : ""} />
        <span className="max-w-40 truncate">{action.title}</span>
      </Button>
    );
  });
}
