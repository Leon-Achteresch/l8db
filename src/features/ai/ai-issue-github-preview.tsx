import { Bot, CircleDot } from "lucide-react";
import { ISSUE_FOOTER, ISSUE_LABELS, ISSUE_REPOSITORY } from "@/lib/ai/issue-presentation";
import { AiMarkdown } from "./ai-markdown";

const AUTHOR = "l8db-issue-relay";

export function AiIssueGithubPreview({
  title,
  body,
  screenshot,
  number,
}: {
  title: string;
  body: string;
  screenshot?: string;
  number?: string;
}) {
  const sidebar = [
    ["Assignees", "No one assigned"],
    ["Projects", "None yet"],
    ["Milestone", "No milestone"],
    ["Development", "No branches or pull requests"],
  ];
  return (
    <div data-github-issue-preview className="text-[14px] leading-6">
      <p className="text-xs text-muted-foreground">
        {ISSUE_REPOSITORY.split("/")[0]} /{" "}
        <strong className="text-foreground">{ISSUE_REPOSITORY.split("/")[1]}</strong>
      </p>
      <h2 className="mt-2 break-words text-[26px] font-normal leading-tight tracking-tight">
        {title || "Fehlerbericht"}{" "}
        <span className="font-light text-muted-foreground">{number ? `#${number}` : ""}</span>
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-b pb-4 text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-[#1f883d] px-3 py-1 text-[13px] font-medium text-white">
          <CircleDot className="size-4" />
          Open
        </span>
        <span>
          <strong className="font-semibold text-foreground">{AUTHOR}</strong>
          <span className="mx-1 rounded-full border px-1.5 text-[11px] font-medium">bot</span>
          opened this issue now · 0 comments
        </span>
      </div>
      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex min-w-0 gap-3">
          <span className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground sm:flex">
            <Bot className="size-5" />
          </span>
          <section
            aria-label="Issue-Beschreibung"
            className="min-w-0 flex-1 overflow-hidden rounded-md border border-[#0969da]/40 dark:border-[#4493f8]/40"
          >
            <header className="flex items-center gap-1.5 border-b border-[#0969da]/30 bg-[#ddf4ff] px-4 py-2 text-muted-foreground dark:border-[#4493f8]/30 dark:bg-[#121d2f]">
              <strong className="font-semibold text-foreground">{AUTHOR}</strong>
              <span className="rounded-full border px-1.5 text-[11px] font-medium">bot</span>
              <span>opened now</span>
              <span className="ml-auto rounded-full border px-2 text-[12px] font-medium">
                Author
              </span>
            </header>
            <div className="min-w-0 space-y-3 px-4 py-3 [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:[overflow-wrap:normal] [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3:first-child]:mt-0 [&_pre]:rounded-md [&_pre]:py-3">
              <AiMarkdown source={body || "Der Bericht wird vorbereitet."} />
              <p className="text-sm italic text-foreground">{ISSUE_FOOTER}</p>
              {screenshot && (
                <img
                  src={screenshot}
                  alt="Geschwärzter Screenshot für das GitHub-Issue"
                  className="h-auto w-full max-w-full rounded-md border"
                />
              )}
            </div>
          </section>
        </div>
        <aside aria-label="Issue-Details" className="divide-y text-xs text-muted-foreground">
          <div className="pb-3">
            <p className="mb-1.5 font-semibold text-foreground">Labels</p>
            <div className="flex flex-wrap gap-1">
              {ISSUE_LABELS.map((label) => (
                <span
                  key={label.name}
                  style={{ backgroundColor: `#${label.color}` }}
                  className={`rounded-full px-2 py-px text-[12px] font-medium ${label.dark ? "text-white" : "text-black"}`}
                >
                  {label.name}
                </span>
              ))}
            </div>
          </div>
          {sidebar.map(([name, value]) => (
            <div key={name} className="py-3">
              <p className="mb-1 font-semibold text-foreground">{name}</p>
              <p>{value}</p>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
