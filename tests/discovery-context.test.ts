import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const host = window as unknown as Record<string, unknown>;
if (typeof host.addEventListener !== "function")
  Object.assign(host, { addEventListener() {}, removeEventListener() {} });
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const { FEATURE_CATALOG, featureAvailable, featureById } = await import(
  "../src/lib/discovery/catalog"
);
const { hasFeatureEventListeners, recordFeatureEvent } = await import(
  "../src/lib/discovery/events"
);
const { recordFeatureUse, resetDiscoveryProgress, useFeatureUsageStore } = await import(
  "../src/lib/discovery/usage"
);
const { PROMOTER_RULES } = await import("../src/lib/discovery/promoter/rules");
const {
  evaluatePromoterRules,
  matchRule,
  PROMOTER_MAX_WINDOW_EVENTS,
  PROMOTER_RULE_COOLDOWN_MS,
  promoterHit,
  pushPromoterEvent,
} = await import("../src/lib/discovery/promoter/engine");
const { PROMOTER_STORAGE_KEY, usePromoterStore } = await import(
  "../src/lib/discovery/promoter/store"
);
const { installPromoter } = await import("../src/lib/discovery/promoter/controller");
const { retrySurface } = await import("../src/lib/discovery/promoter/retry-surface");
const { WAIT_TIPS } = await import("../src/lib/discovery/wait-tips/tips");
const { pickWaitTip, waitTipsFor } = await import("../src/lib/discovery/wait-tips/pick");
const { useWaitTipStore } = await import("../src/lib/discovery/wait-tips/current");
const { installWaitTips, useWaitTipsSeenStore } = await import(
  "../src/lib/discovery/wait-tips/controller"
);
const {
  feedbackIssueText,
  isNewFeature,
  MAX_FEEDBACK_ANSWERS,
  MAX_FEEDBACK_ASKED,
  MAX_FEEDBACK_TEXT,
  shouldAskFeedback,
  useFeedbackStore,
} = await import("../src/lib/discovery/feedback/store");
const { installFeedback } = await import("../src/lib/discovery/feedback/controller");
const { relatedSuggestion, useRelatedStore } = await import("../src/lib/discovery/related/store");
const { installRelated } = await import("../src/lib/discovery/related/controller");
const { POSTGRES_CAPABILITIES } = await import("../src/lib/providers");
const { commandById } = await import("../src/lib/hotkeys");

import type { Capabilities } from "../src/lib/db";
import type { FeatureEvent, FeatureEventData } from "../src/lib/discovery/events";

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const PG = POSTGRES_CAPABILITIES;
const granted = () => "granted" as const;

function ev(name: string, at: number, data: FeatureEventData = {}): FeatureEvent {
  const defaults: FeatureEventData =
    name === "query.executed"
      ? {
          hash: "h1",
          ok: true,
          durationMs: 100,
          hasJoin: false,
          hasWhere: false,
          family: "postgres",
        }
      : name === "table.opened"
        ? { family: "postgres", drawer: false }
        : {};
  return { name, at, data: { ...defaults, ...data } };
}

function rule(id: string) {
  const found = PROMOTER_RULES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(id);
  return found;
}

function series(
  name: string,
  count: number,
  step: number,
  data: (i: number) => FeatureEventData = () => ({}),
) {
  return Array.from({ length: count }, (_, index) => ev(name, T0 + index * step, data(index)));
}

function matches(id: string, events: FeatureEvent[]) {
  return matchRule(rule(id), events, events[events.length - 1].at);
}

beforeEach(() => {
  resetDiscoveryProgress();
  usePromoterStore.setState({ stats: {}, active: null });
  useFeedbackStore.setState({ asked: [], answers: [], active: null });
  useRelatedStore.setState({ shown: [], active: null });
  useWaitTipsSeenStore.setState({ seen: [] });
  useWaitTipStore.setState({ tip: null });
});

describe("promoter rules", () => {
  test("every rule targets a real catalog feature", () => {
    expect(PROMOTER_RULES.length).toBeGreaterThanOrEqual(6);
    for (const candidate of PROMOTER_RULES) expect(featureById(candidate.featureId)).toBeDefined();
    expect(new Set(PROMOTER_RULES.map((candidate) => candidate.id)).size).toBe(
      PROMOTER_RULES.length,
    );
  });

  test("repeat-query needs the same hash three times within 30 min", () => {
    expect(matches("repeat-query", series("query.executed", 3, MIN))).toBe(true);
    expect(matches("repeat-query", series("query.executed", 2, MIN))).toBe(false);
    expect(
      matches(
        "repeat-query",
        series("query.executed", 3, MIN, (i) => ({ hash: `h${i}` })),
      ),
    ).toBe(false);
    expect(
      matches(
        "repeat-query",
        series("query.executed", 3, MIN, () => ({ ok: false })),
      ),
    ).toBe(false);
    expect(matches("repeat-query", series("query.executed", 3, 15 * MIN))).toBe(true);
    const late = series("query.executed", 3, 15 * MIN);
    late[2] = ev("query.executed", T0 + 30 * MIN + 1);
    expect(matches("repeat-query", late)).toBe(false);
  });

  test("repeat-slow-query needs the same slow hash twice", () => {
    const slow = () => ({ durationMs: 2_500 });
    expect(matches("repeat-slow-query", series("query.executed", 2, MIN, slow))).toBe(true);
    expect(matches("repeat-slow-query", series("query.executed", 1, MIN, slow))).toBe(false);
    expect(
      matches(
        "repeat-slow-query",
        series("query.executed", 2, MIN, () => ({ durationMs: 1_999 })),
      ),
    ).toBe(false);
  });

  test("slow-query triggers at exactly 5 s", () => {
    expect(matches("slow-query", [ev("query.executed", T0, { durationMs: 5_000 })])).toBe(true);
    expect(matches("slow-query", [ev("query.executed", T0, { durationMs: 4_999 })])).toBe(false);
    expect(
      matches("slow-query", [ev("query.executed", T0, { durationMs: 9_000, ok: false })]),
    ).toBe(false);
  });

  test("joins needs three join queries", () => {
    const join = () => ({ hasJoin: true });
    expect(matches("joins", series("query.executed", 3, MIN, join))).toBe(true);
    expect(matches("joins", series("query.executed", 2, MIN, join))).toBe(false);
  });

  test("manual-where needs a table first and no filter use", () => {
    const where = (at: number) => ev("query.executed", at, { hasWhere: true });
    expect(matches("manual-where", [ev("table.opened", T0), where(T0 + 1), where(T0 + 2)])).toBe(
      true,
    );
    expect(matches("manual-where", [where(T0 + 1), where(T0 + 2)])).toBe(false);
    expect(
      matches("manual-where", [
        ev("table.opened", T0),
        ev("table.filtered", T0 + 1),
        where(T0 + 2),
        where(T0 + 3),
      ]),
    ).toBe(false);
    expect(matches("manual-where", [ev("table.opened", T0), where(T0 + 16 * MIN)])).toBe(false);
  });

  test("repeat-export needs the same target three times", () => {
    expect(
      matches(
        "repeat-export",
        series("export.done", 3, 30 * MIN, () => ({ target: "a" })),
      ),
    ).toBe(true);
    expect(
      matches(
        "repeat-export",
        series("export.done", 3, MIN, (i) => ({ target: `t${i % 2}` })),
      ),
    ).toBe(false);
  });

  test("failing-queries needs three failures in 10 min", () => {
    const fail = () => ({ ok: false });
    expect(matches("failing-queries", series("query.executed", 3, MIN, fail))).toBe(true);
    expect(matches("failing-queries", series("query.executed", 3, 5 * MIN + 1, fail))).toBe(false);
  });

  test("many-queries counts distinct hashes", () => {
    expect(
      matches(
        "many-queries",
        series("query.executed", 8, MIN, (i) => ({ hash: `h${i}` })),
      ),
    ).toBe(true);
    expect(matches("many-queries", series("query.executed", 8, MIN))).toBe(false);
  });

  test("table-hopping ignores drawers", () => {
    expect(matches("table-hopping", series("table.opened", 6, MIN))).toBe(true);
    expect(matches("table-hopping", series("table.opened", 5, MIN))).toBe(false);
    expect(
      matches(
        "table-hopping",
        series("table.opened", 6, MIN, (i) => ({ drawer: i === 5 })),
      ),
    ).toBe(false);
  });

  test("a rule only fires on its own trigger event", () => {
    const events = [...series("query.executed", 3, MIN), ev("table.opened", T0 + 3 * MIN)];
    expect(matchRule(rule("repeat-query"), events, T0 + 3 * MIN)).toBe(false);
  });
});

describe("promoter engine", () => {
  const events = series("query.executed", 3, MIN);
  const now = events[2].at;
  const ids = (list: { id: string }[]) => list.map((item) => item.id);

  test("skips features that are already used often", () => {
    expect(ids(evaluatePromoterRules(events, {}, now, { capabilities: PG }))).toContain(
      "repeat-query",
    );
    const often = { "query.snippets": { count: 3, first: T0, last: T0 } };
    expect(ids(evaluatePromoterRules(events, often, now, { capabilities: PG }))).not.toContain(
      "repeat-query",
    );
    const rarely = { "query.snippets": { count: 2, first: T0, last: T0 } };
    expect(ids(evaluatePromoterRules(events, rarely, now, { capabilities: PG }))).toContain(
      "repeat-query",
    );
  });

  test("skips features that are unavailable for the connection", () => {
    const joins = series("query.executed", 3, MIN, () => ({ hasJoin: true }));
    const at = joins[2].at;
    const noFk: Capabilities = { ...PG, foreign_keys: false };
    expect(ids(evaluatePromoterRules(joins, {}, at, { capabilities: PG }))).toContain("joins");
    expect(ids(evaluatePromoterRules(joins, {}, at, { capabilities: noFk }))).not.toContain(
      "joins",
    );
    expect(ids(evaluatePromoterRules(joins, {}, at, { capabilities: null }))).not.toContain(
      "joins",
    );
  });

  test("skips muted, accepted and exhausted rules", () => {
    const base = { hits: 1, shown: 1, lastHitAt: T0, lastShownAt: T0 };
    for (const stat of [
      { ...base, muted: true },
      { ...base, accepted: true },
      { ...base, shown: 3 },
    ]) {
      const result = evaluatePromoterRules(events, {}, now, {
        capabilities: PG,
        stats: { "repeat-query": stat },
      });
      expect(ids(result)).not.toContain("repeat-query");
    }
  });

  test("hit thresholds and cooldown work like shortcut hints", () => {
    const windowMs = rule("repeat-query").windowMs;
    let { stat, show } = promoterHit(undefined, { windowMs }, T0);
    expect(show).toBe(true);
    stat = { ...stat, shown: 1, lastShownAt: T0 };
    expect(promoterHit(stat, { windowMs }, T0 + windowMs - 1).stat).toBe(stat);
    ({ stat, show } = promoterHit(stat, { windowMs }, T0 + windowMs));
    expect(show).toBe(false);
    ({ stat, show } = promoterHit(stat, { windowMs }, T0 + 2 * windowMs));
    expect(stat.hits).toBe(3);
    expect(show).toBe(false);
    ({ show } = promoterHit(stat, { windowMs }, T0 + PROMOTER_RULE_COOLDOWN_MS));
    expect(show).toBe(true);
  });

  test("event window ignores unrelated events and stays bounded", () => {
    const window: FeatureEvent[] = [];
    expect(pushPromoterEvent(window, ev("query.started", T0))).toBe(false);
    for (let index = 0; index < 1_000; index++)
      pushPromoterEvent(window, ev("query.executed", T0 + index));
    expect(window.length).toBe(PROMOTER_MAX_WINDOW_EVENTS);
    pushPromoterEvent(window, ev("query.executed", T0 + 24 * 60 * MIN));
    expect(window.length).toBe(1);
  });
});

describe("promoter store and controller", () => {
  test("controller shows the matching rule once and cleans up", () => {
    const stop = installPromoter(() => ({ capabilities: PG, easyMode: false }), {
      attempt: granted,
    });
    for (let index = 0; index < 3; index++)
      recordFeatureEvent("query.executed", ev("query.executed", 0).data);
    expect(usePromoterStore.getState().active).toBe("repeat-query");
    expect(usePromoterStore.getState().stats["repeat-query"].shown).toBe(1);
    usePromoterStore.getState().dismiss();
    recordFeatureEvent("query.executed", ev("query.executed", 0).data);
    expect(usePromoterStore.getState().active).toBeNull();
    stop();
    expect(hasFeatureEventListeners()).toBe(false);
  });

  test("muting persists and syncs from another window", () => {
    usePromoterStore.getState().mute("joins");
    expect(localStorage.getItem(PROMOTER_STORAGE_KEY)).toContain('"muted":true');
    localStorage.setItem(
      PROMOTER_STORAGE_KEY,
      JSON.stringify({
        state: {
          stats: {
            "slow-query": { hits: 2, shown: 1, lastHitAt: 1, lastShownAt: 1, accepted: true },
            bogus: {},
          },
        },
        version: 1,
      }),
    );
    usePromoterStore.persist.rehydrate();
    const { stats } = usePromoterStore.getState();
    expect(stats["slow-query"].accepted).toBe(true);
    expect(stats.bogus).toBeUndefined();
    resetDiscoveryProgress();
    expect(usePromoterStore.getState().stats).toEqual({});
  });

  test("retry stops when the channel is off", () => {
    let calls = 0;
    const stop = retrySurface({ channel: "promoter", id: "x", priority: 1 }, () => {}, {
      attempt: () => {
        calls++;
        return "stop";
      },
      intervalMs: 1,
    });
    stop();
    expect(calls).toBe(1);
  });
});

describe("wait tips", () => {
  const filter = (
    family: string | null,
    capabilities: Capabilities | null = PG,
    easyMode = false,
  ) => ({
    family,
    capabilities,
    easyMode,
    usage: {},
  });

  test("curated tips reference real features and hotkeys", () => {
    expect(WAIT_TIPS.length).toBeGreaterThanOrEqual(20);
    expect(WAIT_TIPS.length).toBeLessThanOrEqual(30);
    for (const tip of WAIT_TIPS) {
      if (tip.featureId) expect(featureById(tip.featureId)).toBeDefined();
      if (tip.hotkey) expect(commandById(tip.hotkey)).toBeDefined();
      expect(tip.text.includes("{hotkey}")).toBe(Boolean(tip.hotkey));
    }
  });

  test("family filter keeps only matching dialect tips", () => {
    const pg = waitTipsFor(filter("postgres")).map((tip) => tip.id);
    expect(pg).toContain("pg-buffers");
    expect(pg).not.toContain("mysql-explain-analyze");
    const mysql = waitTipsFor(filter("mysql")).map((tip) => tip.id);
    expect(mysql).toContain("mysql-explain-analyze");
    expect(mysql).not.toContain("pg-buffers");
    expect(waitTipsFor(filter(null, null)).map((tip) => tip.id)).not.toContain("explain");
  });

  test("easy mode and usage filter catalog tips", () => {
    const hidden = FEATURE_CATALOG.find(
      (entry) => entry.hiddenInEasyMode && featureAvailable(entry, { capabilities: PG }),
    );
    expect(hidden).toBeDefined();
    expect(waitTipsFor(filter("postgres")).map((tip) => tip.id)).toContain(`catalog:${hidden?.id}`);
    expect(waitTipsFor(filter("postgres", PG, true)).map((tip) => tip.id)).not.toContain(
      `catalog:${hidden?.id}`,
    );
    const used = { ...filter("postgres"), usage: { notebook: { count: 1, first: 1, last: 1 } } };
    expect(waitTipsFor(used).map((tip) => tip.id)).not.toContain("catalog:notebook");
  });

  test("rotation does not repeat before every tip was seen", () => {
    const tips = waitTipsFor(filter("postgres"));
    let seen: string[] = [];
    const shown: string[] = [];
    for (let index = 0; index < tips.length; index++) {
      const result = pickWaitTip(tips, seen);
      seen = result.seen;
      shown.push(result.tip?.id ?? "");
    }
    expect(new Set(shown).size).toBe(tips.length);
    const next = pickWaitTip(tips, seen);
    expect(next.tip?.id).toBe(tips[0].id);
    expect(next.seen).toEqual([tips[0].id]);
    expect(pickWaitTip([], seen).tip).toBeNull();
  });

  test("nothing below the delay, tip after it, gone on finish", async () => {
    const stop = installWaitTips({ delayMs: 40, enabled: () => true, resolve: filter });
    recordFeatureEvent("query.started", { id: "q-a", family: "postgres" });
    await Bun.sleep(10);
    expect(useWaitTipStore.getState().tip).toBeNull();
    await Bun.sleep(60);
    expect(useWaitTipStore.getState().tip).not.toBeNull();
    recordFeatureEvent("query.finished", { id: "q-a", ok: false });
    expect(useWaitTipStore.getState().tip).toBeNull();
    stop();
  });

  test("cancelling before the delay shows nothing", async () => {
    const stop = installWaitTips({ delayMs: 30, enabled: () => true, resolve: filter });
    recordFeatureEvent("query.started", { id: "q-b", family: "postgres" });
    recordFeatureEvent("query.finished", { id: "q-b", ok: false });
    await Bun.sleep(50);
    expect(useWaitTipStore.getState().tip).toBeNull();
    expect(useWaitTipsSeenStore.getState().seen).toEqual([]);
    stop();
  });

  test("disabled channel starts no timer", async () => {
    const stop = installWaitTips({ delayMs: 10, enabled: () => false, resolve: filter });
    recordFeatureEvent("query.started", { id: "q-c", family: "postgres" });
    await Bun.sleep(30);
    expect(useWaitTipStore.getState().tip).toBeNull();
    stop();
    expect(hasFeatureEventListeners()).toBe(false);
  });
});

describe("feedback", () => {
  const realFetch = globalThis.fetch;
  let fetches = 0;
  beforeEach(() => {
    fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      return new Response("");
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("only new features qualify", () => {
    expect(isNewFeature("query.editor.checkpoints")).toBe(true);
    expect(isNewFeature("discover.promoter")).toBe(true);
    expect(isNewFeature("query.run")).toBe(false);
    expect(isNewFeature("constructor")).toBe(false);
    expect(shouldAskFeedback("query.editor.checkpoints", 2, [])).toBe(false);
    expect(shouldAskFeedback("query.editor.checkpoints", 3, [])).toBe(true);
    expect(shouldAskFeedback("query.editor.checkpoints", 3, ["query.editor.checkpoints"])).toBe(
      false,
    );
  });

  test("asks exactly once after the third use and sends nothing", () => {
    let attempts = 0;
    const stop = installFeedback({
      attempt: () => {
        attempts++;
        return "granted";
      },
    });
    const id = "query.editor.checkpoints";
    recordFeatureUse(id);
    recordFeatureUse(id);
    expect(useFeedbackStore.getState().active).toBeNull();
    recordFeatureUse(id);
    expect(useFeedbackStore.getState().active).toBe(id);
    useFeedbackStore.getState().answer(id, "down", "  zu langsam  ");
    for (let index = 0; index < 5; index++) recordFeatureUse(id);
    stop();
    expect(attempts).toBe(1);
    expect(useFeedbackStore.getState().asked).toEqual([id]);
    expect(useFeedbackStore.getState().answers[0]).toMatchObject({
      vote: "down",
      text: "zu langsam",
    });
    expect(fetches).toBe(0);
    expect(feedbackIssueText(useFeedbackStore.getState().answers[0])).toContain("👎 – zu langsam");
  });

  test("answers and asked ids stay bounded", () => {
    const store = useFeedbackStore.getState();
    for (let index = 0; index < MAX_FEEDBACK_ANSWERS + 10; index++)
      store.answer(`f${index}`, "up", "x".repeat(MAX_FEEDBACK_TEXT + 100), T0 + index);
    for (let index = 0; index < MAX_FEEDBACK_ASKED + 10; index++) store.markAsked(`a${index}`);
    const state = useFeedbackStore.getState();
    expect(state.answers.length).toBe(MAX_FEEDBACK_ANSWERS);
    expect(state.answers[0].featureId).toBe("f10");
    expect(state.answers.every((answer) => answer.text.length === MAX_FEEDBACK_TEXT)).toBe(true);
    expect(state.asked.length).toBe(MAX_FEEDBACK_ASKED);
    resetDiscoveryProgress();
    expect(useFeedbackStore.getState().answers).toEqual([]);
  });
});

describe("related", () => {
  test("suggests the first unused, available related feature", () => {
    expect(relatedSuggestion("explain", {}, [], { capabilities: PG })?.to).toBe("index-advisor");
    const used = { "index-advisor": { count: 1, first: 1, last: 1 } };
    expect(relatedSuggestion("explain", used, [], { capabilities: PG })?.to).toBe("saved-plan");
    expect(
      relatedSuggestion("explain", {}, ["explain>index-advisor"], { capabilities: PG })?.to,
    ).toBe("saved-plan");
    expect(
      relatedSuggestion("explain", {}, [], { capabilities: { ...PG, explain: false } }),
    ).toBeNull();
    expect(relatedSuggestion("unknown.feature", {}, [])).toBeNull();
  });

  test("each pair is suggested at most once", () => {
    const stop = installRelated(() => ({ capabilities: PG, easyMode: false }), {
      attempt: granted,
    });
    useFeatureUsageStore.setState({ usage: {}, extra: 0 });
    recordFeatureUse("explain");
    expect(useRelatedStore.getState().active?.pair).toBe("explain>index-advisor");
    useRelatedStore.getState().dismiss();
    recordFeatureUse("explain");
    expect(useRelatedStore.getState().active?.pair).toBe("explain>saved-plan");
    useRelatedStore.getState().dismiss();
    recordFeatureUse("explain");
    stop();
    expect(useRelatedStore.getState().active).toBeNull();
    expect(useRelatedStore.getState().shown).toEqual([
      "explain>index-advisor",
      "explain>saved-plan",
    ]);
  });
});
