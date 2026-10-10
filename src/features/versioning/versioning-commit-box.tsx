import { CheckIcon, ChevronDownIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningCommitBox({
  workspace,
  development,
  pending = 0,
  prepare,
  exclude = [],
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
  pending?: number;
  prepare?: () => Promise<string[]>;
  exclude?: string[];
}) {
  const { message, setMessage, selected, changes } = development;
  const count = selected.filter((file) => !exclude.includes(file)).length + pending;
  const canCommit = count > 0 && Boolean(message.trim()) && !workspace.dirty && !workspace.busy;
  const committed = `${count} ${count === 1 ? "Änderung" : "Änderungen"} committet`;
  const commit = async (push = false) => {
    const written = prepare ? await prepare() : [];
    try {
      await development.commit(push, written, exclude);
    } catch (cause) {
      if (written.length) await workspace.refresh().catch(() => undefined);
      throw cause;
    }
  };
  const open = changes.size + pending > 0;
  const label = `Commit${count ? ` (${count})` : ""}`;
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Commit-Nachricht"
        placeholder={
          open
            ? `Commit-Nachricht für ${workspace.status?.branch ?? "HEAD"}`
            : "Keine offenen Änderungen"
        }
        disabled={!open}
        value={message}
        rows={2}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canCommit) void workspace.run(() => commit(), committed);
          }
        }}
        className="max-h-40 min-h-14 resize-none text-xs md:text-xs"
      />
      <ButtonGroup className="w-full">
        <Button
          size="sm"
          className="flex-1"
          disabled={!canCommit}
          onClick={() => void workspace.run(() => commit(), committed)}
        >
          <CheckIcon className="size-3.5" />
          {label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className="px-2"
              disabled={!canCommit}
              aria-label="Weitere Commit-Optionen"
            >
              <ChevronDownIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => void workspace.run(() => commit(true), `${committed} und gepusht`)}
            >
              <UploadIcon />
              Commit und Push
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </div>
  );
}
