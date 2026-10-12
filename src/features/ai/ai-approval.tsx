import { ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type ApprovalAnswers, ApprovalCard } from "@/components/primitives/approval-card";
import { RecommendationCard } from "@/components/primitives/recommendation-card";
import { Button } from "@/components/ui/button";
import { approvalSummary } from "@/lib/ai/approval-presentation";
import { type AiEvent, aiApprove, aiRespond } from "@/lib/db/ai";
import { AiSchemaField } from "./ai-schema-field";

interface Props {
  event: AiEvent;
  runId: string;
  onResolved: (id: string) => void;
  onError: (message: string) => void;
}
export function AiApproval({ event, runId, onResolved, onError }: Props) {
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
  const act = async (allow: boolean, submitted: ApprovalAnswers = {}) => {
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
  const extra = !questionInput && Object.keys(details).some((key) => key !== "requestedSchema") && (
    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/80">
      {JSON.stringify(details, null, 2)}
    </pre>
  );
  const actions = (
    <>
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => void act(false)}>
        Ablehnen
      </Button>
      <Button size="xs" disabled={pending || missing} onClick={() => void act(true)}>
        {schema && Object.keys(properties).length ? "Antwort senden" : "Erlauben"}
      </Button>
    </>
  );
  return (
    <fieldset
      ref={region}
      tabIndex={-1}
      aria-label="Agent benötigt eine Entscheidung"
      className="outline-none"
    >
      {questionInput ? (
        <ApprovalCard
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
                    label,
                    hint: typeof option.description === "string" ? option.description : undefined,
                  };
                })
              : undefined,
            multiple: Boolean(question.multiSelect ?? question.multiple),
          }))}
          pending={pending}
          onSubmit={(values) => void act(true, values)}
        />
      ) : (
        <RecommendationCard
          title={title}
          meta={
            <>
              <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
              <span className="truncate font-mono">
                {String(data.name ?? details.tool ?? "Agent-Aktion")}
              </span>
            </>
          }
          details={extra || undefined}
          detailsLabel="Details"
          actions={actions}
        >
          {description && <p className="whitespace-pre-wrap">{description}</p>}
          {summary.length > 0 && (
            <dl className="mt-2 space-y-2 rounded-lg bg-muted/40 p-2.5">
              {summary.map((entry) => (
                <div key={`${entry.label}-${entry.value}`}>
                  <dt className="text-[10px] text-muted-foreground">{entry.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground/90">
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
            <details className="mt-3">
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
        </RecommendationCard>
      )}
    </fieldset>
  );
}
