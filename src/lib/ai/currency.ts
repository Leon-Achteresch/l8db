import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";

export const AI_CURRENCIES = ["USD", "EUR", "CHF", "GBP", "JPY", "CAD", "AUD", "PLN"];
export const AI_RATES_URL = "https://api.frankfurter.dev/v1/latest?base=USD";
export const AI_RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEY = "l8db.ai.currency";

interface AiCurrencyState {
  code: string;
  manual: number | null;
  rates: Record<string, number>;
  date: string;
  fetchedAt: number;
  setCode: (code: string) => void;
  setManual: (rate: number | null) => void;
}

export const useAiCurrency = create<AiCurrencyState>()(
  persist(
    (set) => ({
      code: "USD",
      manual: null,
      rates: {},
      date: "",
      fetchedAt: 0,
      setCode: (code) => set({ code: AI_CURRENCIES.includes(code) ? code : "USD", manual: null }),
      setManual: (manual) =>
        set({ manual: manual !== null && Number.isFinite(manual) && manual > 0 ? manual : null }),
    }),
    { name: KEY, storage: createSafeJsonStorage() },
  ),
);
syncAcrossWindows(KEY, () => void useAiCurrency.persist.rehydrate());

export function aiCurrencyRate(state: {
  code: string;
  manual: number | null;
  rates: Record<string, number>;
}): number | null {
  if (state.code === "USD") return 1;
  const rate = state.manual ?? state.rates[state.code];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function parseAiRates(data: unknown): { rates: Record<string, number>; date: string } {
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const source = body.rates && typeof body.rates === "object" ? body.rates : {};
  const rates: Record<string, number> = {};
  for (const code of AI_CURRENCIES) {
    const rate = (source as Record<string, unknown>)[code];
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  return {
    rates,
    date: typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "",
  };
}

let pending: Promise<void> | null = null;
let attemptedAt = 0;

export function refreshAiRates(now = Date.now()): Promise<void> {
  const state = useAiCurrency.getState();
  if (
    state.code === "USD" ||
    now - state.fetchedAt < AI_RATES_MAX_AGE_MS ||
    (!pending && now - attemptedAt < 10 * 60 * 1000)
  )
    return Promise.resolve();
  attemptedAt = now;
  pending ??= fetch(AI_RATES_URL, { signal: AbortSignal.timeout(8000) })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const { rates, date } = parseAiRates(data);
      if (Object.keys(rates).length) useAiCurrency.setState({ rates, date, fetchedAt: now });
    })
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function formatAiCost(
  value: number,
  state: { code: string; manual: number | null; rates: Record<string, number> },
  source = "USD",
): string {
  const rate = source === "USD" ? aiCurrencyRate(state) : null;
  const amount = value * (rate ?? 1);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: rate ? state.code : source,
    minimumFractionDigits: 2,
    maximumFractionDigits: amount < 0.01 ? 5 : amount < 0.1 ? 3 : 2,
  }).format(amount);
}
