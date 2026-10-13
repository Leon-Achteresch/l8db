import { CheckIcon, ChevronDownIcon, TicketIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { findTickets, ticketPrefix } from "@/lib/versioning/review";
import type { DevelopmentState } from "./use-development";
import { useTickets } from "./use-tickets";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningIconButton } from "./versioning-icon-button";

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
  const tickets = useTickets(workspace);
  const branchTickets = findTickets([workspace.status?.branch], tickets.configuration).filter(
    (ticket) => !message.includes(ticket.key),
  );
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
      <div className="relative">
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
          className={`max-h-40 min-h-14 resize-none text-xs md:text-xs${branchTickets.length && open ? " pr-8" : ""}`}
        />
        {open && branchTickets.length > 0 && (
          <VersioningIconButton
            icon={TicketIcon}
            label={`${branchTickets.map((ticket) => ticket.key).join(", ")} aus dem Branch in die Nachricht übernehmen`}
            className="absolute top-1 right-1 size-6 [&_svg]:size-3.5"
            onClick={() => setMessage(ticketPrefix(message.trim(), branchTickets))}
          />
        )}
      </div>
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
