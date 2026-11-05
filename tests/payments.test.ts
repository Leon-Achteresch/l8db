import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: Object.assign(new EventTarget(), { localStorage: window.localStorage }),
});

const calls: { command: string; args?: Record<string, unknown> }[] = [];
const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    const handler = handlers.get(command);
    return handler ? handler(args) : null;
  },
}));

const payments = await import("../src/lib/db/payments");
const { SupabasePaymentsSection } = await import(
  "../src/features/baas/supabase-studio/payments/supabase-payments-section"
);

const REF = "abcdefghijklmnopqrst";
const project = {
  id: REF,
  reference: REF,
  name: "acme",
  region: "eu-central-1",
  status: "ACTIVE_HEALTHY",
  organization_id: null,
  database: null,
  self_hosted: false,
  api_url: null,
  secret_key: false,
};

function render(client: QueryClient, management = true) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SupabasePaymentsSection, {
        project,
        capabilities: { management, sql: true, data_api: true } as never,
      }),
    ),
  );
}

beforeEach(() => {
  calls.length = 0;
  handlers.clear();
});

describe("Zahlungen-Bridge", () => {
  test("übergibt Argumente in camelCase, trimmt Schlüssel und Adresse", async () => {
    await payments.paymentsConnect(REF, "  sk_test_abcdefghijklmnop ", false);
    await payments.paymentsList(REF, "subscriptions", "account", "sub_1");
    await payments.paymentsList(REF, "products", "project");
    await payments.paymentsMutate(
      REF,
      { action: "cancel_subscription", id: "sub_1" },
      "id-1234567890abcdef",
    );
    await payments.paymentsSetup(REF, " https://app.example.com/ ", true);
    expect(calls).toEqual([
      {
        command: "payments_connect",
        args: { reference: REF, secretKey: "sk_test_abcdefghijklmnop", allowLive: false },
      },
      {
        command: "payments_list",
        args: { reference: REF, resource: "subscriptions", scope: "account", cursor: "sub_1" },
      },
      {
        command: "payments_list",
        args: { reference: REF, resource: "products", scope: "project", cursor: null },
      },
      {
        command: "payments_mutate",
        args: {
          reference: REF,
          action: { action: "cancel_subscription", id: "sub_1" },
          requestId: "id-1234567890abcdef",
        },
      },
      {
        command: "payments_setup",
        args: { reference: REF, applicationOrigin: "https://app.example.com", confirmed: true },
      },
    ]);
  });

  test("Beträge werden ohne Gleitkommafehler in die kleinste Einheit umgerechnet", () => {
    expect(payments.toMinorUnits("9,99", "eur")).toBe(999);
    expect(payments.toMinorUnits("0.29", "usd")).toBe(29);
    expect(payments.toMinorUnits("19.5", "eur")).toBe(1950);
    expect(payments.toMinorUnits("1200", "jpy")).toBe(1200);
    expect(payments.toMinorUnits("5", "ugx")).toBe(500);
    expect(payments.toMinorUnits("5.50", "ugx")).toBeNull();
    expect(payments.toMinorUnits("5", "isk")).toBe(500);
    expect(payments.toMinorUnits("5.50", "isk")).toBeNull();
    expect(payments.toMinorUnits("12.5", "jpy")).toBeNull();
    expect(payments.toMinorUnits("1.999", "eur")).toBeNull();
    expect(payments.toMinorUnits("0", "eur")).toBeNull();
    expect(payments.toMinorUnits("-1", "eur")).toBeNull();
    expect(payments.toMinorUnits("1e3", "eur")).toBeNull();
    expect(payments.formatAmount(999, "eur")).toContain("9,99");
    expect(payments.formatAmount(1200, "jpy")).toContain("1.200");
    expect(payments.formatAmount(500, "ugx")).toMatch(/^5\s/);
  });

  test("Schlüssel-Erkennung verlangt Secret oder Restricted Keys", () => {
    expect(payments.isStripeKey("sk_test_abcdefgh")).toBe(true);
    expect(payments.isStripeKey("rk_live_abcdefgh")).toBe(true);
    expect(payments.isStripeKey("pk_test_abcdefgh")).toBe(false);
    expect(payments.isLiveKey(" sk_live_abc")).toBe(true);
    expect(payments.isLiveKey("sk_test_abc")).toBe(false);
  });

  test("Wiederholungen derselben Aktion behalten die Anfrage-ID, neue Eingaben erzeugen eine neue", () => {
    const action = { action: "create_product", name: "Pro", description: null } as const;
    const first = payments.paymentIntent(null, action);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payments.paymentIntent(first, { ...action }).id).toBe(first.id);
    expect(payments.paymentIntent(first, { ...action, name: "Team" }).id).not.toBe(first.id);
  });

  test("Abo-Periodenende folgt der Basil-Struktur der Stripe-API", () => {
    expect(payments.formatStripeDate(null)).toBe("–");
    expect(payments.formatStripeDate(Number.NaN)).toBe("–");
    expect(payments.formatStripeDate(Number.POSITIVE_INFINITY)).toBe("–");
    expect(
      payments.subscriptionPeriodEnd({
        id: "sub_1",
        items: { data: [{ current_period_end: 42 }] },
      }),
    ).toBe(42);
    expect(payments.subscriptionPeriodEnd({ id: "sub_1", current_period_end: 7 })).toBe(7);
  });
});

describe("Zahlungen-Ansicht", () => {
  test("zeigt Modus, Bereich und nur Aktionen für Projektobjekte", () => {
    const client = new QueryClient();
    client.setQueryData([...payments.paymentsKey(REF), "status"], {
      connected: true,
      test_mode: true,
      account_id: "acct_123",
      origin: "https://app.example.com",
      webhook_id: null,
      setup_current: false,
    });
    client.setQueryData([...payments.paymentsKey(REF), "products", "project"], {
      pages: [
        {
          data: [
            { id: "prod_own", name: "Pro-Abo", active: true, metadata: { l8db_project: REF } },
            { id: "prod_other", name: "Fremd", active: true, metadata: {} },
          ],
          has_more: true,
          next_cursor: "page_2",
        },
      ],
      pageParams: [null],
    });
    const html = render(client);
    expect(html).toContain("Testmodus");
    expect(html).toContain("acct_123");
    expect(html).toContain("Einrichtung nötig");
    expect(html).toContain(`Stripe-Suche nach Metadatum l8db_project = ${REF}`);
    expect(html).toContain("Pro-Abo");
    expect(html).toContain("Archivieren");
    expect(html).toContain("nur lesen");
    expect(html).toContain("Weitere laden");
    expect(html).not.toContain("sk_test");
    expect(calls).toHaveLength(0);
  });

  test("Live-Modus ist sichtbar markiert", () => {
    const client = new QueryClient();
    client.setQueryData([...payments.paymentsKey(REF), "status"], {
      connected: true,
      test_mode: false,
      account_id: "acct_live",
      origin: null,
      webhook_id: "we_1",
      setup_current: true,
    });
    const html = render(client);
    expect(html).toContain("LIVE");
    expect(html).not.toContain("Einrichtung nötig");
  });

  test("ohne Verbindung erscheint nur das Schlüsselformular, ohne Verwaltungstoken ein Hinweis", () => {
    const client = new QueryClient();
    client.setQueryData([...payments.paymentsKey(REF), "status"], {
      connected: false,
      test_mode: true,
      account_id: null,
      origin: null,
      webhook_id: null,
      setup_current: false,
    });
    const html = render(client);
    expect(html).toContain('type="password"');
    expect(html).toContain("Verbinden");
    expect(html).not.toContain("Produkt anlegen");
    expect(render(new QueryClient(), false)).toContain("Supabase-Cloud-Projekt mit Zugangstoken");
  });
});
