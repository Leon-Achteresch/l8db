import { MessageCircleQuestion, ShieldAlert, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { type ApprovalAnswers, ApprovalCard } from "@/components/primitives/approval-card";
import { RecommendationCard } from "@/components/primitives/recommendation-card";
import { Button } from "@/components/ui/button";
import { approvalSummary } from "@/lib/ai/approval-presentation";
import { type AiEvent, aiApprove, aiRespond } from "@/lib/db/ai";
import { pickElement } from "@/lib/dom-picker";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { captureRedactedScreenshot } from "@/lib/issue-screenshot";
import { AiIssueCard } from "./ai-issue-card";
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
  const [picked, setPicked] = useState<string | null>(null);
  const region = useRef<HTMLFieldSetElement>(null);
  const picking = useRef<AbortController | null>(null);
  const impact = useNewFeatureVisibility<HTMLDivElement>("ai.chat.dry-run");
  const data = event.data;
  const id = String(data.id);
  useEffect(() => {
    if (id) region.current?.focus({ preventScroll: true });
  }, [id]);
  useEffect(() => () => picking.current?.abort(), []);
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
  const invalidJson = (() => {
    if (!advanced.trim()) return false;
    try {
      JSON.parse(advanced);
      return false;
    } catch {
      return true;
    }
  })();
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
      } else if (allow && picked) await aiRespond(runId, id, { allowed: true, screenshot: picked });
      else await aiApprove(runId, id, allow);
      onResolved(id);
    } catch (error) {
      onError(String(error));
    } finally {
      setPending(false);
    }
  };
  const pick = async () => {
    setPending(true);
    picking.current = new AbortController();
    try {
      const element = await pickElement(picking.current.signal);
      if (!element || picking.current.signal.aborted) return;
      const png = await captureRedactedScreenshot(element);
      if (png) setPicked(png);
      else onError("Bereich konnte nicht aufgenommen werden.");
    } catch (error) {
      onError(String(error));
    } finally {
      setPending(false);
    }
  };
  const title = String(data.title ?? (questionInput ? "Rückfrage" : "Freigabe erforderlich"));
  const summary = approvalSummary(details).filter((entry) => entry.value !== title);
  const connection = summary.find((entry) => entry.label === "Verbindung")?.value;
  const rawDescription =
    typeof data.details === "string"
      ? data.details
      : String(details.message ?? details.description ?? details.command ?? details.sql ?? "");
  const description = summary.some((entry) => entry.value === rawDescription) ? "" : rawDescription;
  const { screenshot, ...shown } = details;
  const preview =
    typeof screenshot === "string" && screenshot.startsWith("data:image/png;base64,")
      ? screenshot
      : null;
  const extra = !questionInput &&
    !schema &&
    Object.keys(shown).some((key) => key !== "requestedSchema") && (
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/80">
        {JSON.stringify(shown, null, 2)}
      </pre>
    );
  const actions = (
    <>
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => void act(false)}>
        Ablehnen
      </Button>
      <Button size="xs" disabled={pending || missing || invalidJson} onClick={() => void act(true)}>
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
      {details.tool === "report_issue" &&
      typeof details.title === "string" &&
      typeof details.body === "string" ? (
        <AiIssueCard
          title={details.title}
          body={details.body}
          screenshot={picked ? `data:image/png;base64,${picked}` : (preview ?? undefined)}
          pending={pending}
          onPublish={() => void act(true)}
          onCancel={() => void act(false)}
          onPick={() => void pick()}
        />
      ) : questionInput ? (
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
          icon={schema ? <MessageCircleQuestion /> : <ShieldAlert />}
          meta={
            data.name || details.tool || connection ? (
              <span className="truncate">
                <span className="font-mono">{String(data.name ?? details.tool ?? "")}</span>
                {data.name || details.tool ? (connection ? ` · ${connection}` : "") : connection}
              </span>
            ) : undefined
          }
          details={extra || undefined}
          detailsLabel="Details"
          actions={actions}
        >
          {description && <p className="whitespace-pre-wrap">{description}</p>}
          {preview && (
            <img
              src={preview}
              alt="Geschwärzter Screenshot, der mitgesendet wird"
              title="Geschwärzter Screenshot"
              className="mt-2 max-h-64 w-full rounded-xl bg-muted object-contain"
            />
          )}
          {summary.length > 0 && (
            <dl className="mt-2 space-y-2">
              {summary
                .filter((entry) => entry.label !== "Verbindung")
                .map((entry) =>
                  entry.label === "Auswirkung" ? (
                    <div
                      key={`${entry.label}-${entry.value}`}
                      ref={impact.ref}
                      className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-foreground"
                    >
                      <dt className="sr-only">{entry.label}</dt>
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        {entry.value}
                      </dd>
                      {impact.isNew && <NewBadge />}
                    </div>
                  ) : /^(SQL|Anweisungen|Befehl)$/.test(entry.label) ? (
                    <div key={`${entry.label}-${entry.value}`}>
                      <dt className="sr-only">{entry.label}</dt>
                      <dd className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/70 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground/90">
                        {entry.value}
                      </dd>
                    </div>
                  ) : (
                    <div key={`${entry.label}-${entry.value}`} className="flex gap-3">
                      <dt className="w-20 shrink-0 text-muted-foreground">{entry.label}</dt>
                      <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">
                        {entry.value}
                      </dd>
                    </div>
                  ),
                )}
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
              <summary className="min-h-7 cursor-pointer py-1 text-[11px]">
                Als JSON antworten
              </summary>
              <textarea
                aria-label="Antwort als JSON"
                value={advanced}
                disabled={pending}
                onChange={(event) => setAdvanced(event.target.value)}
                aria-invalid={invalidJson}
                className="mt-2 min-h-20 w-full rounded-xl bg-muted/60 p-2.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {invalidJson && <p className="text-xs text-destructive">Kein gültiges JSON.</p>}
            </details>
          )}
        </RecommendationCard>
      )}
    </fieldset>
  );
}
