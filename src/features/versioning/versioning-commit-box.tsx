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
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
}) {
  const { message, setMessage, canCommit, committed, commit, selected, changes } = development;
  const label = `Commit${selected.length ? ` (${selected.length})` : ""}`;
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Commit-Nachricht"
        placeholder={
          changes.size
            ? `Commit-Nachricht für ${workspace.status?.branch ?? "HEAD"}`
            : "Keine offenen Änderungen"
        }
        disabled={!changes.size}
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
