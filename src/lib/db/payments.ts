import { invoke } from "./core";

export type PaymentResource = "products" | "prices" | "customers" | "subscriptions" | "invoices";
export type PaymentScope = "project" | "account";
export type PaymentInterval = "day" | "week" | "month" | "year";

export interface PaymentStatus {
  connected: boolean;
  test_mode: boolean;
  account_id: string | null;
  origin: string | null;
  webhook_id: string | null;
  setup_current: boolean;
}

export interface PaymentRecord {
  id: string;
  object?: string;
  name?: string | null;
  email?: string | null;
  description?: string | null;
  active?: boolean;
  created?: number;
  currency?: string;
  unit_amount?: number | null;
  amount_due?: number;
  amount_paid?: number;
  total?: number;
  status?: string;
  customer?: string | null;
  product?: string | null;
  type?: string;
  nickname?: string | null;
  recurring?: { interval?: string; interval_count?: number } | null;
  items?: { data?: { price?: PaymentRecord; current_period_end?: number }[] };
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  livemode?: boolean;
  url?: string | null;
  hosted_invoice_url?: string | null;
  number?: string | null;
  customer_email?: string | null;
  metadata?: { l8db_project?: string } | null;
}

export interface PaymentPage {
  data: PaymentRecord[];
  has_more: boolean;
  next_cursor: string | null;
}

export type PaymentAction =
  | { action: "create_product"; name: string; description: string | null }
  | { action: "archive_product"; id: string }
  | {
      action: "create_price";
      product: string;
      currency: string;
      amount: number;
      interval: PaymentInterval | null;
    }
  | { action: "create_customer"; email: string; name: string | null }
  | { action: "cancel_subscription"; id: string }
  | { action: "create_checkout"; price: string; customer: string | null }
  | { action: "create_portal"; customer: string };

export interface PaymentFunctionPreview {
  slug: string;
  url: string;
  verify_jwt: boolean;
  source: string;
}

export interface PaymentSetupPreview {
  sql: string;
  schema: string;
  functions: PaymentFunctionPreview[];
  secrets: string[];
  events: string[];
  webhook_url: string;
  api_version: string;
}

export interface PaymentSetupOutcome {
  webhook_url: string;
  checkout_url: string;
  webhook_id: string;
  test_mode: boolean;
  account_id: string;
  schema: string;
}

export const PAYMENT_PAGE_LIMIT = 100;
export const PAYMENT_MAX_PAGES = 5;
export const PAYMENT_QUERY_OPTIONS = {
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false,
} as const;

export const paymentsKey = (reference: string) => ["supabase", reference, "payments"] as const;

export const paymentsStatus = (reference: string) =>
  invoke<PaymentStatus>("payments_status", { reference });
export const paymentsConnect = (reference: string, secretKey: string, allowLive: boolean) =>
  invoke<PaymentStatus>("payments_connect", { reference, secretKey: secretKey.trim(), allowLive });
export const paymentsDisconnect = (reference: string) =>
  invoke<void>("payments_disconnect", { reference });
export const paymentsList = (
  reference: string,
  resource: PaymentResource,
  scope: PaymentScope,
  cursor: string | null = null,
) => invoke<PaymentPage>("payments_list", { reference, resource, scope, cursor });
export const paymentsMutate = (reference: string, action: PaymentAction, requestId: string) =>
  invoke<PaymentRecord>("payments_mutate", { reference, action, requestId });
export const paymentsSetupPreview = (reference: string) =>
  invoke<PaymentSetupPreview>("payments_setup_preview", { reference });
export const paymentsSetup = (reference: string, applicationOrigin: string, confirmed: boolean) =>
  invoke<PaymentSetupOutcome>("payments_setup", {
    reference,
    applicationOrigin: applicationOrigin.trim().replace(/\/+$/, ""),
    confirmed,
  });

const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

export const PAYMENT_CURRENCIES = ["eur", "usd", "gbp", "chf", "sek", "nok", "dkk", "pln", "jpy"];

export const isLiveKey = (key: string) => /^(sk|rk)_live_/.test(key.trim());
export const isStripeKey = (key: string) => /^(sk|rk)_(test|live)_[!-~]{8,}$/.test(key.trim());

export function toMinorUnits(text: string, currency: string): number | null {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const match = /^(\d{1,8})(?:[.,](\d+))?$/.exec(text.trim());
  if (!match || (match[2] && match[2].length > digits)) return null;
  const value = Number(match[1]) * 10 ** digits + Number((match[2] ?? "").padEnd(digits, "0") || 0);
  if ((currency === "isk" || currency === "ugx") && value % 100 !== 0) return null;
  return value >= 1 && value <= 99_999_999 ? value : null;
}

export function formatAmount(amount: number | null | undefined, currency: string | undefined) {
  if (amount === null || amount === undefined || !currency) return "–";
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 10 ** digits);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

const stripeDateFormatter = new Intl.DateTimeFormat("de-DE");

export function formatStripeDate(seconds: number | null | undefined) {
  if (!seconds) return "–";
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? "–" : stripeDateFormatter.format(date);
}

export const belongsToProject = (record: PaymentRecord, reference: string) =>
  record.metadata?.l8db_project === reference;

export const subscriptionPeriodEnd = (record: PaymentRecord) =>
  record.current_period_end ?? record.items?.data?.[0]?.current_period_end ?? null;

export type PaymentIntent = { signature: string; id: string };

export function paymentIntent(
  previous: PaymentIntent | null,
  action: PaymentAction,
): PaymentIntent {
  const signature = JSON.stringify(action);
  return previous?.signature === signature ? previous : { signature, id: crypto.randomUUID() };
}
