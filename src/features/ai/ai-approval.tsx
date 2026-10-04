import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { approvalSummary } from "@/lib/ai/approval-presentation";
import { type AiEvent, aiApprove, aiRespond } from "@/lib/db/ai";
import { AiSchemaField } from "./ai-schema-field";
import { ApprovalCard, type ApprovalCardAnswers } from "./beui/agents/approval-card";
import { ToolApproval } from "./beui/agents/tool-approval";

interface Props {
  event: AiEvent;
  runId: string;
  onResolved: (id: string) => void;
  onError: (message: string) => void;
}
export function AiApproval({ event, runId, onResolved, onError }: Props) {
  const [answers, setAnswers] = useState<ApprovalCardAnswers>({});
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [advanced, setAdvanced] = useState("");
  const [pending, setPending] = useState(false);
  const region = useRef<HTMLFieldSetElement>(null);
  const data = event.data;
  const id = String(data.id);
  useEffect(() => {
    if (id) region.current?.focus();
  }, [id]);
  const details =
    data.details && typeof data.details === "object"
      ? (data.details as Record<string, unknown>)
      : {};
  const schema =
    details.requestedSchema && typeof details.requestedSchema === "object"
      ? (details.requestedSchema as Record<string, unknown>)
      : null;
  const properties =
    schema?.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const questionInput = event.kind === "input" && !schema;
  const questions = Array.isArray(details.questions)
    ? (details.questions as Record<string, unknown>[])
    : [{ id: "answer", question: String(details.message ?? data.title ?? "Deine Antwort") }];
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
  const missing =
    !advanced.trim() &&
    required.some((key) => {
      const value = content[key] ?? properties[key]?.default;
      return value === undefined || value === "";
    });
  const act = async (allow: boolean, submitted = answers) => {
    setPending(true);
    try {
      if (schema) {
        const defaults = Object.fromEntries(
          Object.entries(properties)
            .filter(([, value]) => value.default !== undefined)
            .map(([key, value]) => [key, value.default]),
        );
        const answer = advanced.trim() ? JSON.parse(advanced) : { ...defaults, ...content };
        await aiRespond(runId, id, {
          action: allow ? "accept" : "decline",
          content: allow ? answer : {},
        });
      } else if (questionInput && allow) {
        await aiRespond(runId, id, {
          answers: Object.fromEntries(
            questions.map((question, index) => {
              const key = String(question.id ?? question.question ?? index);
              const answer = submitted[key];
              return [
                key,
                {
                  answers: [
                    ...(answer?.selected ?? []),
                    ...(answer?.custom?.trim() ? [answer.custom.trim()] : []),
                  ],
                },
              ];
            }),
          ),
        });
      } else await aiApprove(runId, id, allow);
      onResolved(id);
    } catch (error) {
      onError(String(error));
    } finally {
      setPending(false);
    }
  };
  const summary = approvalSummary(details);
  const title = String(data.title ?? (questionInput ? "Rückfrage" : "Freigabe erforderlich"));
  const description =
    typeof data.details === "string"
      ? data.details
      : String(details.message ?? details.description ?? details.command ?? details.sql ?? "");
  return (
    <fieldset
      ref={region}
      tabIndex={-1}
      aria-label="Agent benötigt eine Entscheidung"
      className="space-y-2 outline-none"
    >
      {questionInput ? (
        <ApprovalCard
          title={title}
          questions={questions.map((question, index) => ({
            id: String(question.id ?? question.question ?? index),
            title: String(question.question ?? question.header ?? "Deine Antwort"),
            description:
              typeof question.description === "string" ? question.description : undefined,
            options: Array.isArray(question.options)
              ? question.options.map((raw) => {
                  const option =
                    typeof raw === "string" ? { label: raw } : (raw as Record<string, unknown>);
                  const label = String(option.label ?? option.name ?? option.value);
                  return {
                    value: label,
                    label: label + (option.description ? ` · ${option.description}` : ""),
                  };
                })
              : undefined,
            multiple: Boolean(question.multiSelect ?? question.multiple),
            allowCustom: true,
            autoAdvance: false,
            customPlaceholder: "Eigene Antwort …",
          }))}
          answers={answers}
          onAnswersChange={setAnswers}
          status={pending ? "submitting" : "pending"}
          onSubmit={(values) => void act(true, values)}
          submitLabel="Antwort senden"
          className="rounded-xl border bg-muted/20 text-xs"
        />
      ) : schema ? (
        <ApprovalCard
          title={title}
          description={description}
          status={pending ? "submitting" : "pending"}
          approveLabel={Object.keys(properties).length ? "Antwort senden" : "Erlauben"}
          approveDisabled={missing}
          onApprove={() => void act(true)}
          onReject={() => void act(false)}
          className="rounded-xl border bg-muted/20 text-xs"
        >
          {summary.length > 0 && (
            <dl className="mb-3 space-y-2 rounded-lg bg-background p-3 text-xs">
              {summary.map((entry) => (
                <div key={`${entry.label}-${entry.value}`}>
                  <dt className="text-[10px] text-muted-foreground">{entry.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {Object.entries(properties).map(([key, property]) => (
            <AiSchemaField
              key={key}
              name={key}
              schema={property}
              value={content[key] ?? property.default}
              required={required.includes(key)}
              disabled={pending}
              onChange={(value) => setContent((previous) => ({ ...previous, [key]: value }))}
            />
          ))}
          {Object.keys(properties).length > 0 && (
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="min-h-8 cursor-pointer py-1.5">Erweitert: JSON-Antwort</summary>
              <textarea
                aria-label="Antwort als JSON"
                value={advanced}
                disabled={pending}
                onChange={(event) => setAdvanced(event.target.value)}
                className="mt-2 min-h-20 w-full rounded-md border bg-background p-2 font-mono text-xs"
              />
            </details>
          )}
        </ApprovalCard>
      ) : (
        <ToolApproval
          tool={String(data.name ?? details.tool ?? "Agent-Aktion")}
          title={title}
          description={description}
          parameters={summary.map((entry, index) => ({
            id: String(index),
            label: entry.label,
            value: <span className="whitespace-pre-wrap break-words">{entry.value}</span>,
          }))}
          defaultOpen={true}
          status={pending ? "approving" : "pending"}
          onApprove={() => void act(true)}
          onDeny={() => void act(false)}
          className="rounded-xl text-xs"
        />
      )}
      {!questionInput && Object.keys(details).some((key) => key !== "requestedSchema") && (
        <details className="px-3 text-xs text-muted-foreground">
          <summary className="group/details flex min-h-8 cursor-pointer list-none items-center gap-1 py-1.5 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3 transition-transform group-open/details:rotate-90" />
            Vollständige Aktionsdetails
          </summary>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/20 p-3 text-[11px]">
            {JSON.stringify(details, null, 2)}
          </pre>
        </details>
      )}
    </fieldset>
  );
}
