import { SparklesIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { createId } from "@/features/table/table-filter-panel/filter-conditions";
import { filterConditionsText, filterIdentifier } from "@/lib/filter-bar-format";
import { analyzeQuickFilter } from "@/lib/filter-quick-input";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { IS_MAC } from "@/lib/platform";
import { nextRuleColor } from "@/lib/row-rules";
import { cn } from "@/lib/utils";
import { FilterAiPanel } from "./filter-ai-panel";
import { FilterConditionTokens } from "./filter-condition-tokens";
import { FilterModeToggle } from "./filter-mode-toggle";
import { FilterRuleTokens } from "./filter-rule-tokens";
import { FilterSqlField } from "./filter-sql-field";
import { OmnibarHelp } from "./omnibar-help";
import { type OmnibarItem, OmnibarMenu } from "./omnibar-menu";
import { useFilterAi } from "./use-filter-ai";
import { type FilterBarProps, useFilterBarModel } from "./use-filter-bar-model";

export function FilterOmnibar(props: FilterBarProps) {
  const model = useFilterBarModel(props);
  const ai = useFilterAi(model);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("table.filter.ai");
  const listId = useId();
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [help, setHelp] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  const simple = model.mode === "simple";
  const trimmed = text.trim();
  const analysis = useMemo(
    () => analyzeQuickFilter(text, model.columns, model.kind),
    [text, model.columns, model.kind],
  );
  const ruleColor = pickedColor ?? nextRuleColor(model.rules);
  const items: OmnibarItem[] = simple
    ? [
        ...analysis.suggestions.map((column) => ({
          id: `column:${column}`,
          kind: "column" as const,
          column,
        })),
        ...(analysis.parsed
          ? [
              { id: "add" as const, kind: "add" as const },
              { id: "rule" as const, kind: "rule" as const },
            ]
          : []),
        ...(trimmed ? [{ id: "ai" as const, kind: "ai" as const }] : []),
      ]
    : [];
  const preferred = analysis.parsed
    ? items.findIndex((item) => item.kind === "add")
    : analysis.suggestions.length && analysis.word?.text
      ? 0
      : -1;
  const activeIndex = items.length
    ? cursor === null
      ? preferred
      : Math.min(cursor, items.length - 1)
    : -1;
  const aiBusy = ai.state.phase !== "idle";
  const empty = !model.conditions.length && !model.rules.length && !model.hasFilter;
  const showHelp = simple && focused && !trimmed && (help || empty);
  const hint =
    trimmed && !analysis.parsed && !analysis.suggestions.length && analysis.error
      ? `Kein einfacher Filter: ${analysis.error} Mit ${IS_MAC ? "⌘↵" : "Strg+↵"} übersetzt die KI deinen Text.`
      : "";
  const menuOpen = aiBusy || (focused && simple && (items.length > 0 || showHelp || hint !== ""));
  const preview = analysis.parsed
    ? filterConditionsText(
        analysis.parsed.conditions.map((condition) => ({ ...condition, id: "" })),
        analysis.parsed.combinator,
      )
    : "";

  const change = (value: string) => {
    setText(value);
    setCursor(null);
    model.setError("");
  };
  const parsedConditions = () =>
    analysis.parsed?.conditions.map((condition) => ({ ...condition, id: createId() })) ?? [];
  const askAi = (prompt: string) => {
    if (prompt.trim()) {
      void ai.run(prompt);
    } else if (simple) {
      setHelp(true);
      inputRef.current?.focus();
    } else {
      model.setError(
        `In das Feld in eigenen Worten schreiben, was du sehen willst, und ${IS_MAC ? "⌘↵" : "Strg+↵"} drücken.`,
      );
    }
  };
  const addFilter = () => {
    const message = model.addConditions(parsedConditions(), analysis.parsed?.combinator);
    if (message) model.setError(message);
    else change("");
  };
  const addRule = () => {
    if (!analysis.parsed) {
      model.setError(
        "Für eine Farbregel eine Bedingung wie status = 'error' tippen oder die KI fragen.",
      );
      return;
    }
    model.addRule({
      id: createId(),
      color: ruleColor,
      combinator: model.orSupported ? analysis.parsed.combinator : "AND",
      conditions: parsedConditions(),
    });
    setPickedColor(null);
    change("");
  };
  const pick = (item: OmnibarItem) => {
    if (item.kind === "column") {
      change(
        `${text.slice(0, analysis.word?.from ?? text.length)}${filterIdentifier(item.column)} `,
      );
      inputRef.current?.focus();
    } else if (item.kind === "add") addFilter();
    else if (item.kind === "rule") addRule();
    else askAi(trimmed);
  };
  const accept = () => {
    if (ai.state.phase === "preview" && ai.state.changed) {
      if (ai.accept()) change("");
    } else ai.cancel();
  };
  const submitSql = () => {
    if (ai.state.phase === "preview") accept();
    else if (ai.state.phase !== "running") model.applySql(model.sql);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      event.preventDefault();
      if (aiBusy) ai.cancel();
      else if (text) change("");
      else if (help) setHelp(false);
      else inputRef.current?.blur();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (ai.state.phase === "running") return;
      if (ai.state.phase === "preview" && !modifier && trimmed === ai.state.prompt) {
        accept();
        return;
      }
      if (modifier) askAi(trimmed);
      else if (event.shiftKey) addRule();
      else if (items[activeIndex]) pick(items[activeIndex]);
      else if (hint) model.setError(hint);
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length && !aiBusy) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCursor(
        activeIndex < 0
          ? step > 0
            ? 0
            : items.length - 1
          : (activeIndex + step + items.length) % items.length,
      );
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && items[activeIndex]?.kind === "column") {
      event.preventDefault();
      pick(items[activeIndex]);
      return;
    }
    if (event.key === "Backspace" && text === "") {
      const tokens = barRef.current?.querySelectorAll<HTMLElement>(
        '[data-filter-token="condition"] button',
      );
      const last = tokens?.[tokens.length - 1];
      if (last) {
        event.preventDefault();
        last.focus();
      }
    }
  };

  return (
    <div className="shrink-0 border-b bg-muted/30 px-3 py-2">
      <Popover
        open={menuOpen}
        onOpenChange={(open) => {
          if (!open && ai.state.phase !== "running") ai.cancel();
        }}
      >
        <PopoverAnchor asChild>
          <div
            className={cn(
              "rounded-lg p-px transition-colors",
              aiBusy
                ? "animate-gradient bg-linear-to-r from-sky-400 via-violet-400 to-sky-400 bg-size-[300%_100%]"
                : "bg-input focus-within:bg-ring/70",
            )}
          >
            <div
              ref={barRef}
              className="flex min-h-9 flex-wrap items-center gap-1 rounded-[calc(var(--radius-lg)-1px)] bg-background px-1.5 py-1"
            >
              <FilterModeToggle
                mode={model.mode}
                sqlLabel={model.sqlLabel}
                onChange={model.switchMode}
              />
              {simple ? (
                <>
                  <FilterConditionTokens
                    model={model}
                    variant="chip"
                    afterRemove={() => inputRef.current?.focus()}
                  />
                  <input
                    ref={inputRef}
                    value={text}
                    role="combobox"
                    aria-label="Filter eingeben oder KI fragen"
                    aria-expanded={menuOpen}
                    aria-controls={listId}
                    aria-activedescendant={
                      menuOpen && !aiBusy && activeIndex >= 0
                        ? `${listId}-${activeIndex}`
                        : undefined
                    }
                    aria-autocomplete="list"
                    spellCheck={false}
                    placeholder={
                      model.conditions.length
                        ? "Weitere Bedingung …"
                        : "Filtern, z. B. status = 'error' – oder in eigenen Worten für die KI"
                    }
                    onChange={(event) => change(event.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                      setFocused(false);
                      setHelp(false);
                    }}
                    onKeyDown={onKeyDown}
                    className="h-7 min-w-48 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </>
              ) : (
                <FilterSqlField
                  value={model.sql}
                  json={model.json}
                  columns={model.columns}
                  label={model.sqlLabel}
                  dirty={model.sqlDirty && !aiBusy}
                  onChange={(value) => {
                    model.setSql(value);
                    model.setError("");
                  }}
                  onSubmit={submitSql}
                  onAi={() => askAi(model.sql)}
                />
              )}
              <FilterRuleTokens model={model} variant="chip" showLabel={false} />
              {simple && focused && !trimmed ? (
                <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground md:flex">
                  <Kbd>↵</Kbd>Filter
                  <Kbd>⇧↵</Kbd>Farbe
                </span>
              ) : null}
              <Button
                ref={feature.ref}
                type="button"
                variant="ghost"
                size="xs"
                className="relative shrink-0 text-violet-600 dark:text-violet-300"
                title={`In eigenen Worten filtern (${IS_MAC ? "⌘↵" : "Strg+↵"})`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => askAi(simple ? text : model.sql)}
              >
                <SparklesIcon />
                KI
                <Kbd className="hidden md:inline-flex">{IS_MAC ? "⌘↵" : "Strg+↵"}</Kbd>
                {feature.isNew ? <NewBadge className="absolute -top-1.5 -right-2" /> : null}
              </Button>
              {model.hasFilter ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground"
                  aria-label="Alle Filter entfernen"
                  title="Alle Filter entfernen"
                  onClick={() => {
                    model.clearFilters();
                    change("");
                  }}
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[min(34rem,calc(100vw-2rem))] gap-0 p-1.5"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (event.target === inputRef.current) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (barRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          onMouseDown={(event) => {
            if (!aiBusy) event.preventDefault();
          }}
        >
          {aiBusy ? (
            <div className="p-1.5">
              <FilterAiPanel
                ai={ai}
                sqlLabel={model.sqlLabel}
                keyboard={focused}
                onAccept={accept}
              />
            </div>
          ) : showHelp ? (
            <OmnibarHelp />
          ) : (
            <OmnibarMenu
              listId={listId}
              items={items}
              activeIndex={activeIndex}
              text={trimmed}
              preview={preview}
              hint={hint}
              ruleColor={ruleColor}
              onRuleColor={setPickedColor}
              onPick={pick}
              onHover={setCursor}
            />
          )}
        </PopoverContent>
      </Popover>
      {model.error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {model.error}
        </p>
      ) : null}
    </div>
  );
}
