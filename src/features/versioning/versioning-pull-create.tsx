import { GitPullRequestCreateIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { versioningRepository } from "@/lib/db";
import { forge, type PullRequest, pullRequestDraft } from "@/lib/versioning/forge";
import { changedFiles } from "@/lib/versioning/status";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningPullCreate({
  workspace,
  defaultBranch,
  onCreated,
}: {
  workspace: VersioningWorkspace;
  defaultBranch: string | null;
  onCreated: (number: number) => void;
}) {
  const { repo, project, status, run } = workspace;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const branch = status?.branch;
  if (!project || !status?.head || !branch || !defaultBranch || branch === defaultBranch)
    return null;
  const pending = changedFiles(status.changes).size;
  const prepare = () =>
    void run(async () => {
      const proposal = await pullRequestDraft(
        repo,
        project,
        `refs/remotes/origin/${defaultBranch}`,
        "HEAD",
        branch,
      );
      setTitle(proposal.title);
      setBody(proposal.body);
      setOpen(true);
    });
  const create = () =>
    void run(async () => {
      await versioningRepository({ action: "push", repo });
      const pull = await forge<PullRequest>(repo, "create", {
        head: branch,
        base: defaultBranch,
        title: title.trim(),
        body,
        draft,
      });
      setOpen(false);
      await workspace.refresh();
      onCreated(pull.number);
    }, "Pull Request erstellt");
  if (!open)
    return (
      <div className="flex items-center gap-3 rounded-xl bg-muted/35 p-3">
        <GitPullRequestCreateIcon className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-mono text-foreground">{branch}</span> zur Prüfung in{" "}
          <span className="font-mono text-foreground">{defaultBranch}</span> vorschlagen.
          {pending > 0 && ` Zuerst ${pending} offene Änderungen committen.`}
        </p>
        <Button size="sm" disabled={pending > 0} onClick={prepare}>
          Pull Request erstellen…
        </Button>
      </div>
    );
  return (
    <form
      className="space-y-3 rounded-xl bg-muted/35 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
    >
      <h3 className="text-xs font-semibold">
        Pull Request: <span className="font-mono">{branch}</span> →{" "}
        <span className="font-mono">{defaultBranch}</span>
      </h3>
      <Input
        aria-label="Titel des Pull Requests"
        value={title}
        maxLength={250}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        aria-label="Beschreibung des Pull Requests"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="min-h-48 font-mono text-[11px]"
      />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={draft}
          onChange={(event) => setDraft(event.target.checked)}
        />
        Als Entwurf erstellen
      </label>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Der Branch wird vorher veröffentlicht. Die Beschreibung listet Releases, Migrationen und
        erkannte Risiken für das Review.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!title.trim()}>
          Erstellen
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
