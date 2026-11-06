import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type AiAccessLevel, AiAccessStrip } from "@/features/ai/ai-access-strip";
import { AiApproval } from "@/features/ai/ai-approval";
import { AiApprovalPicker } from "@/features/ai/ai-approval-picker";
import { AiAttachmentChips } from "@/features/ai/ai-attachment-chips";
import { AiComposerFrame } from "@/features/ai/ai-composer-frame";
import { AiContextChips } from "@/features/ai/ai-context-chips";
import { AiEmptyHero } from "@/features/ai/ai-empty-hero";
import { AiFastToggle } from "@/features/ai/ai-fast-toggle";
import { AiIssueIntro } from "@/features/ai/ai-issue-intro";
import { AiMentionChips } from "@/features/ai/ai-mention-chips";
import { AiMentionList } from "@/features/ai/ai-mention-list";
import { AiProviderPicker } from "@/features/ai/ai-provider-picker";
import { AiQueue } from "@/features/ai/ai-queue";
import { AiReasoningPicker } from "@/features/ai/ai-reasoning-picker";
import { AiSuggestions } from "@/features/ai/ai-suggestions";
import { AiUsage } from "@/features/ai/ai-usage";
import { PromptInput } from "@/features/ai/beui/agents/prompt-input";
import { useAiStore } from "@/lib/ai/store";
import type { AiEvent, AiModels } from "@/lib/db/ai";
import { cn } from "@/lib/utils";

const noop = () => undefined;

export function AiChatLabComposer({
  empty = false,
  level = "read",
  production = false,
  approvals = [],
  chips = false,
  mentions = false,
  queue = false,
  busy = false,
  prompt = "",
}: {
  empty?: boolean;
  level?: AiAccessLevel;
  production?: boolean;
  approvals?: AiEvent[];
  chips?: boolean;
  mentions?: boolean;
  queue?: boolean;
  busy?: boolean;
  prompt?: string;
}) {
  const profile = useAiStore(
    (state) => state.profiles.find((entry) => entry.id === state.profileId) ?? state.profiles[0],
  );
  const [value, setValue] = useState(prompt);
  const models: AiModels = {
    models: [
      {
        id: profile.model || "default",
        name: "Sonnet 5.5",
        efforts: ["low", "medium", "high"],
        fast: true,
        default: true,
      },
    ],
  };
  return (
    <div className={cn("mx-auto w-full shrink-0 px-3 pt-2 pb-3", empty && "my-auto")}>
      {empty && <AiEmptyHero connectionName="shop-prod" />}
      {mentions && (
        <AiMentionList
          contexts={[
            { id: "m1", kind: "table", label: "public.customers", schema: "public" },
            { id: "m2", kind: "table", label: "public.customer_notes", schema: "public" },
            { id: "m3", kind: "schema", label: "Schema" },
          ]}
          connections={[{ id: "c2", name: "customer-analytics" }]}
          onContext={noop}
          onConnection={noop}
        />
      )}
      {chips && (
        <>
          <div className="mb-2">
            <AiContextChips
              items={[
                { id: "tab", kind: "tab", label: "Editor: Umsatz.sql" },
                { id: "t1", kind: "table", label: "public.orders", schema: "public" },
              ]}
              onRemove={noop}
            />
          </div>
          <AiMentionChips
            connections={[{ id: "c2", name: "analytics" }]}
            disabled={false}
            onRemove={noop}
          />
          <div className="mb-2">
            <AiAttachmentChips
              files={[
                {
                  name: "kunden.csv",
                  path: "/tmp/kunden.csv",
                  format: "csv",
                  delimiter: ",",
                  quote: '"',
                  hasHeader: true,
                  sheet: null,
                  columns: ["id", "name", "region", "seit"],
                  types: [],
                  rows: [],
                  totalRows: 1204,
                },
              ]}
              onRemove={noop}
            />
          </div>
        </>
      )}
      {queue && (
        <AiQueue entries={[{ id: "q1", text: "Danach als Excel exportieren" }]} onRemove={noop} />
      )}
      <AiComposerFrame
        approvals={
          approvals.length
            ? approvals.map((event) => (
                <AiApproval
                  key={String(event.data.id)}
                  event={event}
                  runId="lab"
                  onResolved={noop}
                  onError={noop}
                />
              ))
            : null
        }
      >
        <AiAccessStrip
          level={level}
          production={production}
          connectionLabel="shop-prod"
          connections={<p className="p-3 text-xs text-muted-foreground">Verbindungen</p>}
          onLevel={noop}
          disabled={busy}
          approval={<AiApprovalPicker profile={profile} disabled={busy} />}
          trailing={
            <AiUsage
              data={{ usage: { input_tokens: 61_000, output_tokens: 2_400 } }}
              profile={profile}
              metadata={{}}
              messages={[]}
              prompt=""
              onSettings={noop}
            />
          }
        />
        <PromptInput
          aria-label="Nachricht an AI"
          placeholder={
            approvals.length
              ? "Beantworte die Freigabe, um fortzufahren"
              : "Frage zu deinen Daten …"
          }
          value={value}
          onValueChange={setValue}
          loading={busy}
          queueable
          onStop={noop}
          disabled={approvals.length > 0}
          onSubmit={noop}
          leadingAction={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Anhänge, Wissen, Skills und MCP-Server"
              className="relative size-8 shrink-0 rounded-full"
            >
              <Plus className="size-4" />
            </Button>
          }
          trailingAction={
            <>
              <AiFastToggle profile={profile} models={models} disabled={busy} />
              <AiReasoningPicker profile={profile} models={models} disabled={busy} />
              <AiProviderPicker
                profile={profile}
                models={models}
                disabled={busy}
                loading={false}
                onSelect={noop}
              />
            </>
          }
          className="rounded-none border-0 bg-transparent px-2 pt-2 pb-2 focus-within:border-0"
        />
      </AiComposerFrame>
      {empty && <AiSuggestions onAsk={noop} />}
      {empty && <AiIssueIntro />}
    </div>
  );
}
