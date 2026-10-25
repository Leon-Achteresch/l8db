import type { Page } from "playwright";

export async function seedSupabaseStudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const REF = "abcdefghijklmnopqrst";
    const DAY = 86_400_000;
    const NOW = Date.UTC(2026, 9, 25, 9, 30);
    const iso = (ms: number) => new Date(ms).toISOString();
    const rand = (seed: number) => {
      const x = Math.sin(seed * 9301 + 49297) * 233280;
      return x - Math.floor(x);
    };
    const pick = <T>(items: T[], seed: number) => items[Math.floor(rand(seed) * items.length)];
    const uuid = (seed: number) => {
      const hex = (n: number, len: number) =>
        Math.floor(rand(seed * 7 + n) * 16 ** len)
          .toString(16)
          .padStart(len, "0");
      return `${hex(1, 8)}-${hex(2, 4)}-4${hex(3, 3)}-a${hex(4, 3)}-${hex(5, 6)}${hex(6, 6)}`;
    };

    const project = {
      id: REF,
      reference: REF,
      name: "acme-prod",
      region: "eu-central-1",
      status: "ACTIVE_HEALTHY",
      organization_id: "acme-org",
      database: { host: `db.${REF}.supabase.co`, version: "17.4.1.054" },
      self_hosted: false,
      api_url: null,
      secret_key: true,
    };

    const FIRST = [
      "Anna",
      "Ben",
      "Clara",
      "David",
      "Elif",
      "Finn",
      "Greta",
      "Hannes",
      "Ida",
      "Jonas",
      "Klara",
      "Lukas",
      "Mia",
      "Noah",
      "Paula",
      "Rafael",
      "Sofia",
      "Tim",
      "Uwe",
      "Vera",
    ];
    const LAST = [
      "Müller",
      "Schmidt",
      "Weber",
      "Fischer",
      "Wagner",
      "Becker",
      "Hoffmann",
      "Koch",
      "Richter",
      "Klein",
      "Wolf",
      "Neumann",
    ];
    const PRODUCTS = [
      "Ergo Chair Pro",
      "Standing Desk 160",
      "USB-C Dock",
      "Noise Cancel Headset",
      '4K Monitor 27"',
      "Mechanical Keyboard",
      "Laptop Stand Alu",
      "Webcam HD",
      "Desk Lamp LED",
      "Cable Tray",
      "Monitor Arm Dual",
      "Footrest",
    ];
    const CITIES = [
      "Berlin",
      "Hamburg",
      "München",
      "Köln",
      "Frankfurt",
      "Leipzig",
      "Stuttgart",
      "Wien",
      "Zürich",
    ];

    type Col = {
      name: string;
      type: string;
      nullable?: boolean;
      def?: string;
      pk?: boolean;
      unique?: boolean;
      identity?: boolean;
      enumValues?: string[];
      fk?: string;
    };
    const ts = (name: string, def = "now()"): Col => ({
      name,
      type: "timestamp with time zone",
      def,
    });
    const TABLES: { name: string; rls: boolean; rows: number; cols: Col[] }[] = [
      {
        name: "profiles",
        rls: true,
        rows: 1284,
        cols: [
          { name: "id", type: "uuid", pk: true, fk: "auth.users" },
          { name: "username", type: "text", unique: true },
          { name: "full_name", type: "text", nullable: true },
          { name: "avatar_url", type: "text", nullable: true },
          { name: "website", type: "text", nullable: true },
          {
            name: "plan",
            type: "plan_tier",
            def: "'free'::plan_tier",
            enumValues: ["free", "pro", "team", "enterprise"],
          },
          ts("updated_at"),
        ],
      },
      {
        name: "customers",
        rls: true,
        rows: 3412,
        cols: [
          { name: "id", type: "bigint", pk: true, identity: true },
          { name: "email", type: "text", unique: true },
          { name: "name", type: "text" },
          { name: "company", type: "text", nullable: true },
          { name: "city", type: "text", nullable: true },
          { name: "lifetime_value", type: "numeric(12,2)", def: "0" },
          ts("created_at"),
        ],
      },
      {
        name: "products",
        rls: true,
        rows: 248,
        cols: [
          { name: "id", type: "bigint", pk: true, identity: true },
          { name: "sku", type: "text", unique: true },
          { name: "name", type: "text" },
          { name: "category_id", type: "bigint", fk: "categories" },
          { name: "price", type: "numeric(10,2)" },
          { name: "stock", type: "integer", def: "0" },
          { name: "active", type: "boolean", def: "true" },
          { name: "attributes", type: "jsonb", def: "'{}'::jsonb" },
          ts("created_at"),
        ],
      },
      {
        name: "categories",
        rls: false,
        rows: 18,
        cols: [
          { name: "id", type: "bigint", pk: true, identity: true },
          { name: "slug", type: "text", unique: true },
          { name: "name", type: "text" },
          { name: "parent_id", type: "bigint", nullable: true, fk: "categories" },
        ],
      },
      {
        name: "orders",
        rls: true,
        rows: 18_930,
        cols: [
          { name: "id", type: "bigint", pk: true, identity: true },
          { name: "customer_id", type: "bigint", fk: "customers" },
          {
            name: "status",
            type: "order_status",
            def: "'pending'::order_status",
            enumValues: ["pending", "paid", "shipped", "delivered", "cancelled", "refunded"],
          },
          { name: "total", type: "numeric(12,2)" },
          { name: "currency", type: "text", def: "'EUR'::text" },
          { name: "shipping_city", type: "text", nullable: true },
          ts("created_at"),
        ],
      },
      {
        name: "order_items",
        rls: true,
        rows: 61_204,
        cols: [
          { name: "id", type: "bigint", pk: true, identity: true },
          { name: "order_id", type: "bigint", fk: "orders" },
          { name: "product_id", type: "bigint", fk: "products" },
          { name: "quantity", type: "integer", def: "1" },
          { name: "unit_price", type: "numeric(10,2)" },
        ],
      },
      {
        name: "invoices",
        rls: true,
        rows: 17_655,
        cols: [
          { name: "id", type: "uuid", pk: true, def: "gen_random_uuid()" },
          { name: "number", type: "text", unique: true },
          { name: "order_id", type: "bigint", fk: "orders" },
          { name: "amount", type: "numeric(12,2)" },
          { name: "paid", type: "boolean", def: "false" },
          { name: "due_date", type: "date" },
          { name: "pdf_path", type: "text", nullable: true },
          ts("issued_at"),
        ],
      },
      {
        name: "payments",
        rls: true,
        rows: 16_870,
        cols: [
          { name: "id", type: "uuid", pk: true, def: "gen_random_uuid()" },
          { name: "invoice_id", type: "uuid", fk: "invoices" },
          { name: "provider", type: "text" },
          { name: "provider_ref", type: "text" },
          { name: "amount", type: "numeric(12,2)" },
          ts("received_at"),
        ],
      },
      {
        name: "addresses",
        rls: true,
        rows: 4021,
        cols: [
          { name: "id", type: "bigint", pk: true, identity: true },
          { name: "customer_id", type: "bigint", fk: "customers" },
          { name: "street", type: "text" },
          { name: "zip", type: "text" },
          { name: "city", type: "text" },
          { name: "country", type: "text", def: "'DE'::text" },
        ],
      },
      {
        name: "reviews",
        rls: true,
        rows: 2290,
        cols: [
          { name: "id", type: "bigint", pk: true, identity: true },
          { name: "product_id", type: "bigint", fk: "products" },
          { name: "author_id", type: "uuid", fk: "profiles" },
          { name: "rating", type: "smallint" },
          { name: "body", type: "text", nullable: true },
          ts("created_at"),
        ],
      },
      {
        name: "coupons",
        rls: false,
        rows: 64,
        cols: [
          { name: "code", type: "text", pk: true },
          { name: "percent_off", type: "integer" },
          { name: "valid_until", type: "date", nullable: true },
          { name: "redemptions", type: "integer", def: "0" },
        ],
      },
      {
        name: "audit_log",
        rls: false,
        rows: 412_880,
        cols: [
          { name: "id", type: "bigint", pk: true, identity: true },
          { name: "actor_id", type: "uuid", nullable: true },
          { name: "action", type: "text" },
          { name: "entity", type: "text" },
          { name: "payload", type: "jsonb", nullable: true },
          ts("created_at"),
        ],
      },
    ];
    const EXTRA_TABLES: Record<string, { name: string; rows: number; cols: Col[] }[]> = {
      auth: [
        {
          name: "users",
          rows: 1284,
          cols: [
            { name: "id", type: "uuid", pk: true },
            { name: "email", type: "character varying(255)", nullable: true },
            { name: "role", type: "character varying(255)", nullable: true },
            ts("created_at"),
            { name: "last_sign_in_at", type: "timestamp with time zone", nullable: true },
          ],
        },
        {
          name: "sessions",
          rows: 2210,
          cols: [
            { name: "id", type: "uuid", pk: true },
            { name: "user_id", type: "uuid", fk: "auth.users" },
            ts("created_at"),
            { name: "user_agent", type: "text", nullable: true },
          ],
        },
        {
          name: "identities",
          rows: 1460,
          cols: [
            { name: "id", type: "uuid", pk: true },
            { name: "user_id", type: "uuid" },
            { name: "provider", type: "text" },
            ts("created_at"),
          ],
        },
        {
          name: "refresh_tokens",
          rows: 9840,
          cols: [
            { name: "id", type: "bigint", pk: true, identity: true },
            { name: "token", type: "character varying(255)" },
            { name: "user_id", type: "character varying(255)" },
            { name: "revoked", type: "boolean" },
          ],
        },
      ],
      storage: [
        {
          name: "buckets",
          rows: 4,
          cols: [
            { name: "id", type: "text", pk: true },
            { name: "name", type: "text" },
            { name: "public", type: "boolean" },
            ts("created_at"),
          ],
        },
        {
          name: "objects",
          rows: 5230,
          cols: [
            { name: "id", type: "uuid", pk: true },
            { name: "bucket_id", type: "text" },
            { name: "name", type: "text" },
            { name: "metadata", type: "jsonb", nullable: true },
            ts("created_at"),
          ],
        },
        {
          name: "migrations",
          rows: 42,
          cols: [
            { name: "id", type: "integer", pk: true },
            { name: "name", type: "character varying(100)" },
            ts("executed_at"),
          ],
        },
      ],
      extensions: [
        {
          name: "pg_stat_statements",
          rows: 312,
          cols: [
            { name: "queryid", type: "bigint" },
            { name: "query", type: "text" },
            { name: "calls", type: "bigint" },
            { name: "total_exec_time", type: "double precision" },
          ],
        },
      ],
    };
    const allTables = () => [
      ...TABLES.map((t) => ({ schema: "public", ...t })),
      ...Object.entries(EXTRA_TABLES).flatMap(([schema, list]) =>
        list.map((t) => ({ schema, rls: schema !== "extensions", ...t })),
      ),
    ];
    const findTable = (schema: string, name: string) =>
      allTables().find((t) => t.schema === schema && t.name === name) ?? allTables()[0];

    const cellValue = (table: string, col: Col, i: number): unknown => {
      const s = i * 31 + col.name.length * 7 + table.length;
      const n = col.name;
      if (col.nullable && rand(s + 3) < 0.12) return null;
      if (col.enumValues) return pick(col.enumValues, s);
      if (n === "id" && col.type === "uuid") return uuid(i + table.length * 100);
      if (n === "id" || col.identity) return i + 1;
      if (col.type === "uuid") return uuid(s);
      if (col.type.startsWith("timestamp")) return iso(NOW - Math.floor(rand(s) * 180 * DAY));
      if (col.type === "date")
        return iso(NOW + Math.floor((rand(s) - 0.3) * 60 * DAY)).slice(0, 10);
      if (col.type === "boolean") return rand(s) > 0.25;
      if (col.type === "jsonb")
        return n === "payload"
          ? { ip: `10.0.${i % 255}.${(i * 7) % 255}`, changes: Math.floor(rand(s) * 5) }
          : { color: pick(["schwarz", "weiß", "grau", "eiche"], s), warranty_years: 2 + (i % 3) };
      const person = `${pick(FIRST, s)} ${pick(LAST, s + 1)}`;
      if (n === "email")
        return `${pick(FIRST, s).toLowerCase()}.${pick(LAST, s + 1)
          .toLowerCase()
          .replace("ü", "ue")}${i}@example.com`;
      if (n === "username") return `${pick(FIRST, s).toLowerCase()}_${i + 10}`;
      if (n === "full_name" || n === "name")
        return table === "products"
          ? PRODUCTS[i % PRODUCTS.length]
          : table === "categories"
            ? pick(["Büromöbel", "Elektronik", "Zubehör", "Beleuchtung", "Audio"], i)
            : person;
      if (n === "avatar_url") return `avatars/${uuid(s).slice(0, 8)}.png`;
      if (n === "website") return `https://${pick(LAST, s).toLowerCase().replace("ü", "ue")}.dev`;
      if (n === "company") return `${pick(LAST, s + 2)} ${pick(["GmbH", "AG", "KG", "UG"], s)}`;
      if (n === "city" || n === "shipping_city") return pick(CITIES, s);
      if (n === "sku") return `ACME-${String(1000 + i).padStart(5, "0")}`;
      if (n === "slug") return `kategorie-${i + 1}`;
      if (n === "number") return `RE-2026-${String(4200 + i).padStart(6, "0")}`;
      if (n === "currency") return "EUR";
      if (n === "provider") return pick(["stripe", "paypal", "sepa", "klarna"], s);
      if (n === "provider_ref") return `pi_3P${uuid(s).replace(/-/g, "").slice(0, 18)}`;
      if (n === "street")
        return `${pick(["Haupt", "Garten", "Linden", "Berg"], s)}straße ${1 + (i % 120)}`;
      if (n === "zip") return String(10_000 + Math.floor(rand(s) * 89_999));
      if (n === "country") return pick(["DE", "DE", "DE", "AT", "CH"], s);
      if (n === "pdf_path") return `invoices/2026/${String(4200 + i).padStart(6, "0")}.pdf`;
      if (n === "body")
        return pick(
          [
            "Super Qualität, schnelle Lieferung.",
            "Funktioniert wie beschrieben.",
            "Etwas laut, sonst gut.",
            "Würde ich wieder kaufen!",
            "Verpackung war beschädigt.",
          ],
          s,
        );
      if (n === "action") return pick(["insert", "update", "delete", "login", "export"], s);
      if (n === "entity") return pick(["orders", "invoices", "customers", "products"], s);
      if (n === "code") return `SAVE${10 + (i % 40)}-${uuid(s).slice(0, 4).toUpperCase()}`;
      if (n === "rating") return 1 + Math.floor(rand(s) * 5);
      if (n === "role") return "authenticated";
      if (n === "user_agent")
        return pick(["Mozilla/5.0 (Macintosh)", "Mozilla/5.0 (Windows NT 10.0)", "okhttp/4.12"], s);
      if (n === "token" || n === "user_id") return uuid(s).replace(/-/g, "").slice(0, 16);
      if (n === "bucket_id") return pick(["avatars", "invoices", "product-images"], s);
      if (n === "metadata") return { size: Math.floor(rand(s) * 900_000), mimetype: "image/png" };
      if (n === "query")
        return pick(["select * from orders where id = $1", "insert into audit_log ..."], s);
      if (/(price|total|amount|value)/.test(n)) return Number((5 + rand(s) * 1900).toFixed(2));
      if (/(int|smallint|bigint|numeric|double)/.test(col.type)) return Math.floor(rand(s) * 500);
      return `${n} ${i + 1}`;
    };
    const rowsOf = (schema: string, name: string) => {
      const table = findTable(schema, name);
      return Array.from({ length: Math.min(40, table.rows) }, (_, i) =>
        Object.fromEntries(table.cols.map((c) => [c.name, cellValue(name, c, i)])),
      );
    };
    const studioColumns = (schema: string, name: string) =>
      findTable(schema, name).cols.map((c) => ({
        name: c.name,
        data_type: c.type,
        nullable: !!c.nullable,
        default_value: c.identity ? null : (c.def ?? null),
        is_primary_key: !!c.pk,
        is_unique: !!c.unique || !!c.pk,
        is_identity: !!c.identity,
        is_generated: false,
        enum_values: c.enumValues ?? null,
      }));

    const PROVIDERS = [
      "email",
      "email",
      "email",
      "google",
      "github",
      "apple",
      "phone",
      "anonymous",
    ];
    const authUsers = Array.from({ length: 25 }, (_, i) => {
      const provider = PROVIDERS[i % PROVIDERS.length];
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i * 5) % LAST.length];
      const created = NOW - (i * 4 + rand(i) * 3) * DAY;
      const confirmed = provider !== "email" || i % 4 !== 0;
      return {
        id: uuid(500 + i),
        email:
          provider === "phone" || provider === "anonymous"
            ? null
            : `${first.toLowerCase()}.${last.toLowerCase().replace("ü", "ue")}@${pick(["gmail.com", "acme.io", "posteo.de", "outlook.com"], i)}`,
        phone: provider === "phone" ? `+49 17${i % 10} ${1_000_000 + i * 7331}` : null,
        created_at: iso(created),
        last_sign_in_at: i % 6 === 5 ? null : iso(NOW - rand(i + 40) * 20 * DAY),
        email_confirmed_at:
          confirmed && provider !== "phone" && provider !== "anonymous"
            ? iso(created + 600_000)
            : null,
        phone_confirmed_at: provider === "phone" ? iso(created + 120_000) : null,
        is_anonymous: provider === "anonymous",
        banned_until: i === 11 ? iso(NOW + 30 * DAY) : null,
        providers: provider === "google" && i % 2 ? ["google", "email"] : [provider],
      };
    });

    const BUCKETS = [
      {
        id: "avatars",
        public: true,
        limit: 2_097_152,
        mimes: ["image/png", "image/jpeg", "image/webp"],
      },
      { id: "invoices", public: false, limit: 10_485_760, mimes: ["application/pdf"] },
      { id: "product-images", public: true, limit: 5_242_880, mimes: ["image/*"] },
      { id: "backups", public: false, limit: null, mimes: null },
    ].map((b, i) => ({
      id: b.id,
      name: b.id,
      public: b.public,
      created_at: iso(NOW - (300 - i * 40) * DAY),
      updated_at: iso(NOW - (20 - i * 3) * DAY),
      kind: "STANDARD",
      file_size_limit: b.limit,
      allowed_mime_types: b.mimes,
    }));
    const FILES: Record<string, [string, string, number][]> = {
      avatars: [
        ...Array.from(
          { length: 14 },
          (_, i) =>
            [`users/${uuid(500 + i)}.png`, "image/png", 18_000 + i * 9_731] as [
              string,
              string,
              number,
            ],
        ),
        ["team/anna.jpg", "image/jpeg", 214_880],
        ["team/jonas.jpg", "image/jpeg", 198_240],
        ["team/greta.webp", "image/webp", 74_012],
        ["default.svg", "image/svg+xml", 1_204],
        ["placeholder.png", "image/png", 6_310],
      ],
      invoices: [
        ...Array.from(
          { length: 12 },
          (_, i) =>
            [
              `2026/10/RE-2026-${String(4400 + i).padStart(6, "0")}.pdf`,
              "application/pdf",
              48_000 + i * 2_113,
            ] as [string, string, number],
        ),
        ...Array.from(
          { length: 6 },
          (_, i) =>
            [
              `2026/09/RE-2026-${String(4300 + i).padStart(6, "0")}.pdf`,
              "application/pdf",
              51_000 + i * 1_877,
            ] as [string, string, number],
        ),
        ["2025/archive-2025.zip", "application/zip", 184_220_311],
        ["templates/invoice-de.html", "text/html", 12_480],
        ["templates/invoice-en.html", "text/html", 12_102],
        ["templates/logo.svg", "image/svg+xml", 3_812],
      ],
      "product-images": [
        ...PRODUCTS.map(
          (_, i) =>
            [
              `products/acme-${String(1000 + i).padStart(5, "0")}/main.webp`,
              "image/webp",
              120_000 + i * 18_311,
            ] as [string, string, number],
        ),
        ["banners/herbst-sale.jpg", "image/jpeg", 1_204_511],
        ["banners/black-friday.mp4", "video/mp4", 18_442_901],
        ["manifest.json", "application/json", 2_311],
      ],
      backups: [
        ["db/2026-10-24.sql.gz", "application/gzip", 412_331_008],
        ["db/2026-10-23.sql.gz", "application/gzip", 409_120_774],
        ["db/2026-10-22.sql.gz", "application/gzip", 401_908_551],
        ["exports/customers.csv", "text/csv", 1_832_400],
        ["exports/orders-q3.parquet", "application/octet-stream", 24_120_008],
        ["README.md", "text/markdown", 1_402],
      ],
    };
    const listObjects = (bucket: string, prefix: string, search: string) => {
      const entries = new Map<string, Record<string, unknown>>();
      (FILES[bucket] ?? []).forEach(([path, mime, size], i) => {
        if (!path.startsWith(prefix)) return;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (search && !name.toLowerCase().includes(search.toLowerCase())) return;
        if (entries.has(name)) return;
        const modified = iso(NOW - rand(i + bucket.length) * 90 * DAY);
        entries.set(
          name,
          slash === -1
            ? {
                name,
                id: uuid(900 + i + bucket.length * 50),
                created_at: modified,
                updated_at: modified,
                last_accessed_at: iso(NOW - rand(i) * 5 * DAY),
                metadata: {
                  size,
                  mimetype: mime,
                  eTag: `"${uuid(i).slice(0, 8)}"`,
                  cacheControl: "max-age=3600",
                  lastModified: modified,
                  contentLength: size,
                  httpStatusCode: 200,
                },
              }
            : {
                name,
                id: null,
                created_at: null,
                updated_at: null,
                last_accessed_at: null,
                metadata: null,
              },
        );
      });
      return [...entries.values()].sort(
        (a, b) =>
          Number(a.id !== null) - Number(b.id !== null) ||
          String(a.name).localeCompare(String(b.name)),
      );
    };

    const FUNCTIONS = [
      {
        slug: "stripe-webhook",
        verify_jwt: false,
        version: 14,
        body: `import Stripe from "npm:stripe@17";\nimport { createClient } from "jsr:@supabase/supabase-js@2";\n\nconst stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);\nconst supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);\n\nDeno.serve(async (req) => {\n  const signature = req.headers.get("stripe-signature")!;\n  const event = await stripe.webhooks.constructEventAsync(await req.text(), signature, Deno.env.get("STRIPE_WEBHOOK_SECRET")!);\n  if (event.type === "payment_intent.succeeded") {\n    const intent = event.data.object;\n    await supabase.from("payments").insert({ provider: "stripe", provider_ref: intent.id, amount: intent.amount / 100 });\n  }\n  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });\n});\n`,
      },
      {
        slug: "send-email",
        verify_jwt: true,
        version: 6,
        body: `import { Resend } from "npm:resend@4";\n\nconst resend = new Resend(Deno.env.get("RESEND_API_KEY"));\n\nDeno.serve(async (req) => {\n  const { to, subject, html } = await req.json();\n  const { data, error } = await resend.emails.send({ from: "ACME <noreply@acme.io>", to, subject, html });\n  return Response.json(error ? { error } : data, { status: error ? 400 : 200 });\n});\n`,
      },
      {
        slug: "generate-invoice-pdf",
        verify_jwt: true,
        version: 9,
        body: `import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17";\nimport { createClient } from "jsr:@supabase/supabase-js@2";\n\nDeno.serve(async (req) => {\n  const { invoice_id } = await req.json();\n  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);\n  const { data: invoice } = await supabase.from("invoices").select("*, orders(*)").eq("id", invoice_id).single();\n  const pdf = await PDFDocument.create();\n  const page = pdf.addPage();\n  const font = await pdf.embedFont(StandardFonts.Helvetica);\n  page.drawText(\`Rechnung \${invoice.number}\`, { x: 50, y: 780, size: 20, font });\n  const bytes = await pdf.save();\n  await supabase.storage.from("invoices").upload(invoice.pdf_path, bytes, { contentType: "application/pdf", upsert: true });\n  return Response.json({ path: invoice.pdf_path });\n});\n`,
      },
      {
        slug: "resize-image",
        verify_jwt: false,
        version: 3,
        body: `import { ImageMagick, initialize, MagickFormat } from "npm:@imagemagick/magick-wasm@0.0.30";\n\nawait initialize();\n\nDeno.serve(async (req) => {\n  const url = new URL(req.url);\n  const width = Number(url.searchParams.get("w") ?? 256);\n  const input = new Uint8Array(await req.arrayBuffer());\n  const output = ImageMagick.read(input, (img) => {\n    img.resize(width, 0);\n    return img.write(MagickFormat.Webp, (data) => data);\n  });\n  return new Response(output, { headers: { "Content-Type": "image/webp" } });\n});\n`,
      },
      {
        slug: "openai-chat",
        verify_jwt: true,
        version: 21,
        body: `import OpenAI from "npm:openai@4";\n\nconst openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });\n\nDeno.serve(async (req) => {\n  const { messages } = await req.json();\n  const stream = await openai.chat.completions.create({ model: "gpt-4o-mini", messages, stream: true });\n  return new Response(stream.toReadableStream(), { headers: { "Content-Type": "text/event-stream" } });\n});\n`,
      },
    ];
    const functionDetails = (slug: string) => {
      const f = FUNCTIONS.find((x) => x.slug === slug) ?? FUNCTIONS[0];
      const i = FUNCTIONS.indexOf(f);
      return {
        id: uuid(700 + i),
        slug: f.slug,
        name: f.slug,
        status: i === 3 ? "THROTTLED" : "ACTIVE",
        version: f.version,
        verify_jwt: f.verify_jwt,
        entrypoint_path: `file:///src/functions/${f.slug}/index.ts`,
        import_map_path: i % 2 ? `file:///src/functions/${f.slug}/deno.json` : null,
        import_map: i % 2 === 1,
        created_at: NOW - (200 - i * 30) * DAY,
        updated_at: NOW - (i + 1) * 2.3 * DAY,
        ezbr_sha256: uuid(800 + i).replace(/-/g, ""),
      };
    };

    const SCHEMAS = [
      { name: "public", owner: "postgres", table_count: TABLES.length, protected: false },
      { name: "auth", owner: "supabase_auth_admin", table_count: 16, protected: true },
      { name: "storage", owner: "supabase_storage_admin", table_count: 7, protected: true },
      { name: "extensions", owner: "postgres", table_count: 1, protected: true },
      { name: "analytics", owner: "postgres", table_count: 3, protected: false },
    ];
    const FN_DEFS = [
      ["public", "handle_new_user", "", "trigger", "plpgsql", true],
      ["public", "set_updated_at", "", "trigger", "plpgsql", false],
      ["public", "order_total", "p_order_id bigint", "numeric", "sql", false],
      [
        "public",
        "search_products",
        "query text, max_results integer DEFAULT 20",
        "SETOF products",
        "sql",
        false,
      ],
      ["public", "is_admin", "", "boolean", "sql", true],
      [
        "public",
        "monthly_revenue",
        "p_year integer",
        "TABLE(month integer, revenue numeric)",
        "plpgsql",
        false,
      ],
      ["public", "apply_coupon", "p_order_id bigint, p_code text", "numeric", "plpgsql", true],
      ["public", "audit_changes", "", "trigger", "plpgsql", true],
      ["public", "refresh_sales_stats", "", "void", "plpgsql", false],
      ["auth", "uid", "", "uuid", "sql", false],
      ["auth", "role", "", "text", "sql", false],
      ["auth", "jwt", "", "jsonb", "sql", false],
      ["storage", "foldername", "name text", "text[]", "plpgsql", false],
      ["storage", "extension", "name text", "text", "plpgsql", false],
    ] as const;
    const TRIGGERS = [
      ["profiles", "on_profiles_updated", "BEFORE UPDATE", "set_updated_at"],
      ["orders", "orders_audit", "AFTER INSERT OR UPDATE OR DELETE", "audit_changes"],
      ["invoices", "invoices_audit", "AFTER INSERT OR UPDATE OR DELETE", "audit_changes"],
      ["payments", "payments_audit", "AFTER INSERT", "audit_changes"],
      ["products", "products_updated_at", "BEFORE UPDATE", "set_updated_at"],
      ["order_items", "order_items_refresh_stats", "AFTER INSERT", "refresh_sales_stats"],
    ];
    const ENUMS = [
      ["order_status", ["pending", "paid", "shipped", "delivered", "cancelled", "refunded"]],
      ["plan_tier", ["free", "pro", "team", "enterprise"]],
      ["payment_provider", ["stripe", "paypal", "sepa", "klarna"]],
    ] as const;
    const EXTENSIONS = [
      [
        "pg_stat_statements",
        "1.11",
        "1.11",
        "extensions",
        "track planning and execution statistics of all SQL statements executed",
      ],
      ["pgcrypto", "1.3", "1.3", "extensions", "cryptographic functions"],
      ["uuid-ossp", "1.1", "1.1", "extensions", "generate universally unique identifiers (UUIDs)"],
      ["pg_graphql", "1.5.11", "1.5.11", "graphql", "GraphQL support"],
      ["supabase_vault", "0.3.1", "0.3.1", "vault", "Supabase Vault Extension"],
      ["pg_cron", "1.6", "1.6", "pg_catalog", "Job scheduler for PostgreSQL"],
      ["pg_net", "0.14.0", "0.14.0", "extensions", "Async HTTP"],
      ["vector", "0.8.0", null, null, "vector data type and ivfflat and hnsw access methods"],
      [
        "postgis",
        "3.3.7",
        null,
        null,
        "PostGIS geometry and geography spatial types and functions",
      ],
      [
        "pg_trgm",
        "1.6",
        "1.6",
        "extensions",
        "text similarity measurement and index searching based on trigrams",
      ],
      ["hstore", "1.8", null, null, "data type for storing sets of (key, value) pairs"],
      ["pgjwt", "0.2.0", null, null, "JSON Web Token API for Postgresql"],
      [
        "pg_repack",
        "1.5.2",
        null,
        null,
        "Reorganize tables in PostgreSQL databases with minimal locks",
      ],
      [
        "timescaledb",
        "2.16.1",
        null,
        null,
        "Enables scalable inserts and complex queries for time-series data",
      ],
    ] as const;
    const ROLES = [
      ["postgres", true, false, true, true, true, true, ["pg_read_all_data"]],
      [
        "authenticator",
        true,
        false,
        false,
        false,
        false,
        false,
        ["anon", "authenticated", "service_role"],
      ],
      ["anon", false, false, false, false, false, false, []],
      ["authenticated", false, false, false, false, false, false, []],
      ["service_role", false, false, false, false, true, false, []],
      ["supabase_admin", true, true, true, true, true, true, []],
      ["supabase_auth_admin", true, false, false, true, false, false, []],
      ["supabase_storage_admin", true, false, false, true, false, false, ["authenticator"]],
      ["dashboard_user", false, false, true, true, false, true, []],
      ["reporting_ro", true, false, false, false, false, false, ["pg_read_all_data"]],
      ["etl_worker", true, false, false, false, false, false, []],
    ] as const;
    const POLICIES: Record<
      string,
      {
        name: string;
        command: string;
        roles: string[];
        using: string | null;
        check: string | null;
        permissive?: boolean;
      }[]
    > = {
      profiles: [
        {
          name: "Profile sind öffentlich lesbar",
          command: "SELECT",
          roles: ["public"],
          using: "true",
          check: null,
        },
        {
          name: "Nutzer bearbeiten eigenes Profil",
          command: "UPDATE",
          roles: ["authenticated"],
          using: "(( SELECT auth.uid() AS uid) = id)",
          check: "(( SELECT auth.uid() AS uid) = id)",
        },
        {
          name: "Nutzer legen eigenes Profil an",
          command: "INSERT",
          roles: ["authenticated"],
          using: null,
          check: "(( SELECT auth.uid() AS uid) = id)",
        },
      ],
      orders: [
        {
          name: "Kunden sehen eigene Bestellungen",
          command: "SELECT",
          roles: ["authenticated"],
          using:
            "(customer_id IN ( SELECT customers.id FROM customers WHERE (customers.email = auth.email())))",
          check: null,
        },
        {
          name: "Admins verwalten Bestellungen",
          command: "ALL",
          roles: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
        },
        {
          name: "Keine Löschung stornierter Bestellungen",
          command: "DELETE",
          roles: ["authenticated"],
          using: "(status <> 'cancelled'::order_status)",
          check: null,
          permissive: false,
        },
      ],
      order_items: [
        {
          name: "Positionen der eigenen Bestellung",
          command: "SELECT",
          roles: ["authenticated"],
          using: "(EXISTS ( SELECT 1 FROM orders o WHERE (o.id = order_items.order_id)))",
          check: null,
        },
      ],
      invoices: [
        {
          name: "Rechnungen nur für Admins",
          command: "ALL",
          roles: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
        },
        {
          name: "Service darf alles",
          command: "ALL",
          roles: ["service_role"],
          using: "true",
          check: "true",
        },
      ],
      payments: [
        {
          name: "Service schreibt Zahlungen",
          command: "INSERT",
          roles: ["service_role"],
          using: null,
          check: "true",
        },
      ],
      products: [
        {
          name: "Produkte öffentlich lesbar",
          command: "SELECT",
          roles: ["anon", "authenticated"],
          using: "active",
          check: null,
        },
        {
          name: "Admins pflegen Produkte",
          command: "ALL",
          roles: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
        },
      ],
      reviews: [
        {
          name: "Bewertungen öffentlich",
          command: "SELECT",
          roles: ["public"],
          using: "true",
          check: null,
        },
        {
          name: "Eigene Bewertung schreiben",
          command: "INSERT",
          roles: ["authenticated"],
          using: null,
          check: "(author_id = auth.uid())",
        },
      ],
      customers: [
        {
          name: "Kunden sehen sich selbst",
          command: "SELECT",
          roles: ["authenticated"],
          using: "(email = auth.email())",
          check: null,
        },
      ],
      addresses: [],
    };
    const paged = <T>(items: T[], offset = 0, size = 100) => ({
      items: items.slice(offset, offset + size),
      has_more: items.length > offset + size,
    });
    const matches = (value: string, search: unknown) =>
      !search || value.toLowerCase().includes(String(search).toLowerCase());
    const databaseList = (args: Record<string, unknown>) => {
      const schema = String(args.schema ?? "");
      const parent = String(args.parent ?? "");
      const search = args.search;
      const inSchema = (s: string) => !schema || s === schema;
      let items: Record<string, unknown>[] = [];
      switch (args.kind) {
        case "schemas":
          items = SCHEMAS;
          break;
        case "views":
          items = [
            {
              oid: 30_001,
              schema: "public",
              name: "order_summary",
              materialized: false,
              populated: true,
              comment: "Bestellungen mit Kunde und Summe",
            },
            {
              oid: 30_002,
              schema: "public",
              name: "top_products",
              materialized: false,
              populated: true,
              comment: null,
            },
            {
              oid: 30_003,
              schema: "public",
              name: "sales_stats_daily",
              materialized: true,
              populated: true,
              comment: "Täglich per pg_cron aktualisiert",
            },
            {
              oid: 30_004,
              schema: "public",
              name: "customer_ltv",
              materialized: true,
              populated: false,
              comment: null,
            },
            {
              oid: 30_005,
              schema: "analytics",
              name: "funnel",
              materialized: false,
              populated: true,
              comment: null,
            },
          ].filter((v) => inSchema(v.schema));
          break;
        case "functions":
          items = FN_DEFS.map(
            ([s, name, a, r, lang, sec], i): Record<string, unknown> => ({
              oid: 40_000 + i,
              schema: s,
              name,
              arguments: a,
              return_type: r,
              language: lang,
              security_definer: sec,
              is_procedure: false,
            }),
          )
            .concat([
              {
                oid: 40_100,
                schema: "public",
                name: "archive_old_orders",
                arguments: "older_than interval DEFAULT '2 years'::interval",
                return_type: null,
                language: "plpgsql",
                security_definer: false,
                is_procedure: true,
              },
            ])
            .filter((f) => inSchema(String(f.schema)));
          break;
        case "triggers":
          items = TRIGGERS.map(([table, name, timing, fn], i) => ({
            oid: 50_000 + i,
            schema: "public",
            table_name: table,
            name,
            enabled: i !== 5,
            definition: `CREATE TRIGGER ${name} ${timing} ON public.${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
            function_oid: 40_000 + FN_DEFS.findIndex((f) => f[1] === fn),
            function_name: `public.${fn}`,
          })).filter((t) => inSchema(t.schema) && (!parent || t.table_name === parent));
          break;
        case "indexes":
          items = TABLES.flatMap((t, ti) => {
            const pkCol = t.cols.find((c) => c.pk)?.name ?? "id";
            const list = [
              {
                name: `${t.name}_pkey`,
                cols: pkCol,
                unique: true,
                primary: true,
                constraint: true,
              },
            ];
            for (const c of t.cols.filter((c) => c.unique && !c.pk))
              list.push({
                name: `${t.name}_${c.name}_key`,
                cols: c.name,
                unique: true,
                primary: false,
                constraint: true,
              });
            for (const c of t.cols.filter((c) => c.fk && !c.pk))
              list.push({
                name: `${t.name}_${c.name}_idx`,
                cols: c.name,
                unique: false,
                primary: false,
                constraint: false,
              });
            if (t.cols.some((c) => c.name === "created_at"))
              list.push({
                name: `${t.name}_created_at_idx`,
                cols: "created_at DESC",
                unique: false,
                primary: false,
                constraint: false,
              });
            return list.map((ix, i) => {
              const bytes = Math.floor(t.rows * (40 + rand(ti * 10 + i) * 60));
              return {
                oid: 60_000 + ti * 10 + i,
                schema: "public",
                table_name: t.name,
                name: ix.name,
                definition: `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${ix.name} ON public.${t.name} USING btree (${ix.cols})`,
                method: "btree",
                is_unique: ix.unique,
                is_primary: ix.primary,
                is_valid: !(ti === 10 && i === 1),
                is_constraint: ix.constraint,
                size_bytes: bytes,
                size:
                  bytes > 1_048_576
                    ? `${(bytes / 1_048_576).toFixed(0)} MB`
                    : `${Math.max(8, Math.round(bytes / 1024))} kB`,
                scans: ix.primary
                  ? Math.floor(t.rows * 31 * rand(ti))
                  : Math.floor(rand(ti * 3 + i) * 4000) * (i % 3 === 2 ? 0 : 1),
              };
            });
          }).filter((ix) => inSchema(ix.schema) && (!parent || ix.table_name === parent));
          break;
        case "enums":
          items = ENUMS.map(([name, values], i) => ({
            oid: 70_000 + i,
            schema: "public",
            name,
            enum_values: [...values],
          })).filter((e) => inSchema(e.schema));
          break;
        case "extensions":
          items = EXTENSIONS.map(([name, def, inst, s, comment]) => ({
            name,
            default_version: def,
            installed_version: inst,
            schema: s,
            comment,
          }));
          break;
        case "roles":
          items = ROLES.map(
            (
              [name, login, superuser, createdb, createrole, bypassrls, replication, member_of],
              i,
            ) => ({
              oid: 10 + i * 1000,
              name,
              login,
              inherit: true,
              createdb,
              createrole,
              bypassrls,
              connection_limit: name === "reporting_ro" ? 10 : -1,
              superuser,
              replication,
              valid_until: name === "etl_worker" ? iso(NOW + 90 * DAY) : null,
              member_of: [...member_of],
              protected: !["reporting_ro", "etl_worker"].includes(name),
            }),
          );
          break;
        case "publications":
          items = [
            {
              oid: 80_001,
              name: "supabase_realtime",
              owner: "postgres",
              all_tables: false,
              publish_insert: true,
              publish_update: true,
              publish_delete: true,
              publish_truncate: false,
              table_count: 4,
            },
            {
              oid: 80_002,
              name: "analytics_cdc",
              owner: "postgres",
              all_tables: false,
              publish_insert: true,
              publish_update: true,
              publish_delete: false,
              publish_truncate: false,
              table_count: 2,
            },
          ];
          break;
        case "publication_tables":
          items = (
            parent === "analytics_cdc"
              ? ["orders", "payments"]
              : ["orders", "order_items", "reviews", "profiles"]
          ).map((name) => ({ schema: "public", name }));
          break;
        case "sequences":
          items = TABLES.filter((t) => t.cols.some((c) => c.identity))
            .map((t) => ({
              schema: "public",
              name: `${t.name}_id_seq`,
              data_type: "bigint",
              start_value: "1",
              increment: "1",
              max_value: "9223372036854775807",
              last_value: String(t.rows + 17),
              cycle: false,
            }))
            .filter((s) => inSchema(s.schema));
          break;
        case "rls_tables":
          items = allTables()
            .filter((t) => inSchema(t.schema))
            .map((t, i) => ({
              oid: 20_000 + i,
              schema: t.schema,
              name: t.name,
              rls_enabled: t.rls,
              rls_forced: t.name === "invoices",
              policy_count: t.schema === "public" ? (POLICIES[t.name]?.length ?? 0) : t.rls ? 1 : 0,
              commands:
                t.schema === "public"
                  ? [
                      ...new Set(
                        (POLICIES[t.name] ?? [])
                          .filter((p) => p.permissive !== false)
                          .map((p) => p.command),
                      ),
                    ]
                  : t.rls
                    ? ["SELECT"]
                    : [],
            }));
          break;
        case "policies":
          items = (POLICIES[parent] ?? []).map((p) => ({
            name: p.name,
            permissive: p.permissive ?? true,
            command: p.command,
            roles: p.roles,
            using_expression: p.using,
            check_expression: p.check,
          }));
          break;
      }
      items = items.filter((item) => matches(String(item.name ?? ""), search));
      return paged(items, Number(args.offset ?? 0));
    };

    const STATEMENTS = [
      [
        "select o.*, c.name from orders o join customers c on c.id = o.customer_id where o.created_at > $1 order by o.created_at desc limit $2",
        "authenticated",
        182_340,
        3.8,
        412.5,
        3_646_800,
      ],
      [
        "select * from products where active = $1 and category_id = $2",
        "anon",
        951_220,
        0.42,
        88.1,
        11_414_640,
      ],
      [
        "insert into audit_log (actor_id, action, entity, payload) values ($1, $2, $3, $4)",
        "postgres",
        412_880,
        0.21,
        41.9,
        412_880,
      ],
      ["update orders set status = $1 where id = $2", "service_role", 22_015, 1.9, 120.4, 22_015],
      ["select public.monthly_revenue($1)", "authenticated", 1_204, 284.7, 2_903.3, 14_448],
      [
        "with recursive tree as (select * from categories where parent_id is null union all select c.* from categories c join tree t on c.parent_id = t.id) select * from tree",
        "anon",
        61_002,
        0.95,
        24.0,
        1_098_036,
      ],
      [
        "select count(*) from order_items where product_id = $1",
        "authenticated",
        8_870,
        18.2,
        690.4,
        8_870,
      ],
      [
        "refresh materialized view concurrently sales_stats_daily",
        "postgres",
        30,
        12_480.2,
        18_912.6,
        30,
      ],
      [
        "select * from auth.users where id = $1",
        "supabase_auth_admin",
        412_330,
        0.08,
        12.7,
        412_330,
      ],
      [
        "select id, name, bucket_id, metadata from storage.objects where bucket_id = $1 and name like $2 order by name limit $3",
        "supabase_storage_admin",
        77_410,
        2.4,
        310.8,
        1_548_200,
      ],
      ["delete from coupons where valid_until < now()", "postgres", 30, 4.1, 9.9, 112],
      [
        "select * from invoices where paid = false and due_date < current_date",
        "service_role",
        720,
        64.3,
        401.7,
        92_160,
      ],
    ] as const;
    const logRows = (source: string, level: string, search: string, limit: number) => {
      const messages: Record<string, [string, string][]> = {
        edge_logs: [
          ["GET | 200 | /rest/v1/products?select=*&active=eq.true", "info"],
          ["POST | 201 | /rest/v1/orders", "info"],
          ["GET | 401 | /rest/v1/invoices", "warning"],
          ["PATCH | 204 | /rest/v1/profiles?id=eq.8f1c", "info"],
          ["GET | 500 | /rest/v1/rpc/monthly_revenue", "error"],
          ["GET | 200 | /storage/v1/object/public/avatars/team/anna.jpg", "info"],
        ],
        postgres_logs: [
          [
            "connection authorized: user=authenticator database=postgres application_name=postgrest",
            "info",
          ],
          ["duration: 2903.311 ms  statement: select public.monthly_revenue(2026)", "warning"],
          ['relation "public.order_itemz" does not exist', "error"],
          ["checkpoint complete: wrote 1832 buffers (11.2%)", "info"],
          ['automatic vacuum of table "postgres.public.audit_log": index scans: 1', "info"],
        ],
        auth_logs: [
          ["Login", "info"],
          ["token_refreshed", "info"],
          ["Invalid login credentials", "warning"],
          ["user_signedup", "info"],
          ["429: Email rate limit exceeded", "error"],
        ],
        function_edge_logs: [
          [
            "POST | 200 | https://abcdefghijklmnopqrst.supabase.co/functions/v1/stripe-webhook",
            "info",
          ],
          ["POST | 200 | /functions/v1/send-email", "info"],
          ["POST | 546 | /functions/v1/resize-image", "error"],
          ["POST | 200 | /functions/v1/openai-chat", "info"],
        ],
        function_logs: [
          ["Webhook received: payment_intent.succeeded", "info"],
          ["Memory limit exceeded", "error"],
          ["Rechnung RE-2026-004411 erzeugt", "info"],
          ["Retrying Resend request (1/3)", "warning"],
        ],
        storage_logs: [
          ["GET /object/public/product-images/products/acme-01003/main.webp 200", "info"],
          ["POST /object/invoices/2026/10/RE-2026-004411.pdf 200", "info"],
          ["GET /object/sign/backups/db/2026-10-24.sql.gz 400", "info"],
        ],
        realtime_logs: [
          ["Billing metrics: tenant abcdefghijklmnopqrst", "info"],
          ["Subscribed to PostgreSQL changes on public.orders", "info"],
          ["Channel joined: room:support", "info"],
        ],
      };
      const list = messages[source] ?? messages.edge_logs;
      const rows = Array.from({ length: Math.min(limit || 100, 80) }, (_, i) => {
        const [message, lvl] = list[(i * 7 + Math.floor(rand(i) * 3)) % list.length];
        return {
          id: uuid(1200 + i),
          timestamp: (NOW - i * 41_000 - Math.floor(rand(i) * 20_000)) * 1000,
          event_message: message,
          level: lvl,
          metadata: [
            {
              level: lvl,
              request: {
                method: message.split(" ")[0],
                path: message.split("|")[2]?.trim() ?? null,
                headers: {
                  "user-agent": "supabase-js/2.47.0",
                  "x-client-info": "supabase-js-web/2.47.0",
                },
              },
              response: { status_code: Number(message.split("|")[1]) || 200 },
              execution_time_ms: Math.round(rand(i) * 900),
            },
          ],
        };
      }).filter((r) => (!level || r.level === level) && matches(r.event_message, search));
      return { rows: rows.map(({ level: _l, ...rest }) => rest), has_more: false };
    };

    const sqlResult = (query: string, readOnly: boolean) => {
      const lower = query.toLowerCase();
      if (/^\s*(insert|update|delete|create|alter|drop)/.test(lower))
        return {
          columns: [],
          rows: [],
          row_count: 3,
          truncated: false,
          duration_ms: 18,
          statement_count: 1,
          read_only: readOnly,
        };
      const rows = Array.from({ length: 12 }, (_, i) => ({
        month: iso(Date.UTC(2025, 10 + i, 1)).slice(0, 7),
        orders: 1200 + Math.floor(rand(i) * 800),
        revenue: Number((84_000 + rand(i + 3) * 61_000).toFixed(2)),
        avg_order_value: Number((62 + rand(i + 9) * 30).toFixed(2)),
        new_customers: 140 + Math.floor(rand(i + 5) * 120),
      }));
      return {
        columns: Object.keys(rows[0]),
        rows,
        row_count: rows.length,
        truncated: false,
        duration_ms: 47,
        statement_count: 1,
        read_only: readOnly,
      };
    };

    const AUTH_CONFIG: Record<string, string | number | boolean | null> = {
      site_url: "https://app.acme.io",
      uri_allow_list: "https://app.acme.io/**,http://localhost:3000/**",
      disable_signup: false,
      jwt_exp: 3600,
      external_email_enabled: true,
      external_phone_enabled: true,
      external_anonymous_users_enabled: true,
      external_google_enabled: true,
      external_google_client_id: "1234-acme.apps.googleusercontent.com",
      external_google_secret: "********",
      external_github_enabled: true,
      external_github_client_id: "Iv1.4f2a9c",
      external_github_secret: "********",
      external_apple_enabled: true,
      external_azure_enabled: false,
      external_discord_enabled: false,
      rate_limit_email_sent: 30,
      rate_limit_sms_sent: 30,
      rate_limit_verify: 30,
      rate_limit_token_refresh: 150,
      rate_limit_anonymous_users: 30,
      mailer_autoconfirm: false,
      mailer_secure_email_change_enabled: true,
      mailer_otp_exp: 3600,
      mailer_subjects_confirmation: "Bitte bestätige deine E-Mail-Adresse",
      mailer_subjects_recovery: "Passwort zurücksetzen",
      smtp_host: "smtp.resend.com",
      smtp_port: "465",
      smtp_user: "resend",
      smtp_pass: "********",
      smtp_admin_email: "noreply@acme.io",
      smtp_sender_name: "ACME",
      smtp_max_frequency: 60,
      sms_provider: "twilio",
      sms_otp_exp: 60,
      sms_otp_length: 6,
      sms_twilio_account_sid: "AC4f1d...",
      sms_twilio_auth_token: "********",
      mfa_totp_enroll_enabled: true,
      mfa_totp_verify_enabled: true,
      mfa_phone_enroll_enabled: false,
      mfa_max_enrolled_factors: 10,
      hook_custom_access_token_enabled: true,
      hook_custom_access_token_uri: "pg-functions://postgres/public/custom_access_token_hook",
      hook_send_email_enabled: false,
      password_min_length: 10,
      password_required_characters:
        "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
      security_captcha_enabled: true,
      security_captcha_provider: "turnstile",
      security_refresh_token_reuse_interval: 10,
      refresh_token_rotation_enabled: true,
      sessions_timebox: 0,
      sessions_inactivity_timeout: 0,
      sessions_single_per_user: false,
      db_max_pool_size: 15,
    };

    const invoke = async (command: string, args: Record<string, unknown> = {}) => {
      const a = args;
      switch (command) {
        case "supabase_is_connected":
          return true;
        case "supabase_projects":
        case "supabase_connect":
          return [project];
        case "supabase_connect_self_hosted":
        case "supabase_studio_settings_replace_self_hosted_key":
          return project;
        case "supabase_studio_capabilities":
          return {
            self_hosted: false,
            sql: true,
            management: true,
            service_key: true,
            data_api: true,
          };
        case "supabase_database_endpoint":
          return {
            host: `aws-0-eu-central-1.pooler.supabase.com`,
            port: 5432,
            user: `postgres.${REF}`,
            database: "postgres",
          };
        case "supabase_has_project_key":
          return true;
        case "supabase_health":
          return [
            { name: "db", healthy: true, status: "ACTIVE_HEALTHY" },
            { name: "auth", healthy: true, status: "ACTIVE_HEALTHY" },
            { name: "rest", healthy: true, status: "ACTIVE_HEALTHY" },
            { name: "realtime", healthy: true, status: "ACTIVE_HEALTHY" },
            { name: "storage", healthy: true, status: "ACTIVE_HEALTHY" },
            { name: "pooler", healthy: false, status: "COMING_UP" },
          ];
        case "supabase_backups":
          return {
            pitr_enabled: false,
            backups: Array.from({ length: 7 }, (_, i) => ({
              id: 9000 + i,
              is_physical_backup: true,
              status: i === 0 ? "PENDING" : "COMPLETED",
              inserted_at: iso(NOW - i * DAY),
            })),
            physical_backup_data: {
              earliest_physical_backup_date_unix: Math.floor((NOW - 7 * DAY) / 1000),
              latest_physical_backup_date_unix: Math.floor(NOW / 1000),
            },
          };
        case "supabase_buckets":
          return BUCKETS;
        case "supabase_bucket_details":
          return BUCKETS.find((b) => b.id === a.bucket) ?? BUCKETS[0];
        case "supabase_functions":
          return FUNCTIONS.map((f) => {
            const d = functionDetails(f.slug);
            return {
              id: d.id,
              slug: d.slug,
              name: d.name,
              status: d.status,
              version: d.version,
              verify_jwt: d.verify_jwt,
              entrypoint_path: d.entrypoint_path,
              import_map_path: d.import_map_path,
            };
          });
        case "supabase_tables":
          return {
            tables: allTables().map((t) => ({ schema: t.schema, name: t.name, kind: "table" })),
            has_more: false,
          };
        case "supabase_table_columns":
          return findTable(String(a.schema), String(a.table)).cols.map((c) => ({
            name: c.name,
            data_type: c.type,
            is_nullable: c.nullable ? "YES" : "NO",
          }));
        case "supabase_table_rows":
          return {
            rows: rowsOf(String(a.schema), String(a.table)).map((values, ordinal) => ({
              ordinal,
              values,
            })),
            has_more: false,
          };
        case "supabase_objects":
          return listObjects(String(a.bucket), String(a.prefix ?? ""), "");
        case "supabase_auth_users":
          return { users: authUsers };
        case "supabase_upload_object":
          return null;
        case "supabase_download_object":
          return true;
        case "supabase_preview_object":
          return null;

        case "supabase_studio_sql_run":
          return sqlResult(String(a.query ?? ""), !!a.readOnly);

        case "supabase_studio_tables_schemas":
          return ["public", "auth", "storage", "extensions"];
        case "supabase_studio_tables_list": {
          const schema = String(a.schema ?? "public");
          const list = allTables()
            .filter((t) => t.schema === schema && matches(t.name, a.search))
            .map((t) => ({
              schema: t.schema,
              name: t.name,
              kind: t.schema === "extensions" ? "view" : "table",
              rls_enabled: t.rls,
              estimated_rows: t.rows as number | null,
            }));
          if (schema === "public" && !a.search)
            list.push(
              {
                schema: "public",
                name: "order_summary",
                kind: "view",
                rls_enabled: false,
                estimated_rows: null,
              },
              {
                schema: "public",
                name: "sales_stats_daily",
                kind: "materialized_view",
                rls_enabled: false,
                estimated_rows: 365,
              },
            );
          return { tables: list, has_more: false };
        }
        case "supabase_studio_tables_describe": {
          const schema = String(a.schema);
          const name = String(a.table);
          const table = findTable(schema, name);
          const isView = name === "order_summary" || name === "sales_stats_daily";
          return {
            schema,
            name,
            kind: isView ? (name === "order_summary" ? "view" : "materialized_view") : "table",
            rls_enabled: table.rls,
            columns: studioColumns(schema, table.name),
            foreign_keys: table.cols
              .filter((c) => c.fk)
              .map((c) => {
                const [fs, ft] = c.fk?.includes(".") ? c.fk.split(".") : ["public", c.fk ?? ""];
                return {
                  name: `${table.name}_${c.name}_fkey`,
                  definition: `FOREIGN KEY (${c.name}) REFERENCES ${fs}.${ft}(id) ON DELETE ${c.name === "id" ? "CASCADE" : "RESTRICT"}`,
                  foreign_schema: fs,
                  foreign_table: ft,
                };
              }),
            indexes: [
              {
                name: `${table.name}_pkey`,
                definition: `CREATE UNIQUE INDEX ${table.name}_pkey ON ${schema}.${table.name} USING btree (${table.cols.find((c) => c.pk)?.name ?? "id"})`,
                is_unique: true,
                is_primary: true,
              },
              ...table.cols
                .filter((c) => c.unique)
                .map((c) => ({
                  name: `${table.name}_${c.name}_key`,
                  definition: `CREATE UNIQUE INDEX ${table.name}_${c.name}_key ON ${schema}.${table.name} USING btree (${c.name})`,
                  is_unique: true,
                  is_primary: false,
                })),
              ...table.cols
                .filter((c) => c.fk && !c.pk)
                .map((c) => ({
                  name: `${table.name}_${c.name}_idx`,
                  definition: `CREATE INDEX ${table.name}_${c.name}_idx ON ${schema}.${table.name} USING btree (${c.name})`,
                  is_unique: false,
                  is_primary: false,
                })),
            ],
            view_definition: isView
              ? " SELECT o.id,\n    o.created_at,\n    c.name AS customer,\n    o.total\n   FROM orders o\n     JOIN customers c ON c.id = o.customer_id;"
              : null,
            introspected: true,
          };
        }
        case "supabase_studio_tables_rows": {
          const q = (a.query ?? {}) as {
            offset?: number;
            sort_column?: string | null;
            sort_desc?: boolean;
          };
          let rows = rowsOf(String(a.schema), String(a.table));
          if (q.sort_column) {
            const col = q.sort_column;
            rows = [...rows].sort(
              (x, y) =>
                String(x[col] ?? "").localeCompare(String(y[col] ?? ""), "de", { numeric: true }) *
                (q.sort_desc ? -1 : 1),
            );
          }
          return { rows: rows.slice(q.offset ?? 0), has_more: false };
        }
        case "supabase_studio_tables_insert_row":
        case "supabase_studio_tables_update_row":
          return { ...((a.key as object) ?? {}), ...((a.values as object) ?? {}) };
        case "supabase_studio_tables_delete_rows":
          return Array.isArray(a.keys) ? a.keys.length : 0;

        case "supabase_studio_database_list":
          return databaseList(a);
        case "supabase_studio_database_definition":
          return a.kind === "view"
            ? "CREATE OR REPLACE VIEW public.order_summary AS\n SELECT o.id,\n    o.created_at,\n    c.name AS customer,\n    o.total\n   FROM orders o\n     JOIN customers c ON c.id = o.customer_id;"
            : "CREATE OR REPLACE FUNCTION public.handle_new_user()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n  insert into public.profiles (id, full_name, avatar_url)\n  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');\n  return new;\nend;\n$function$";

        case "supabase_studio_auth_users": {
          const filter = String(a.filter ?? "all");
          const sort = String(a.sort ?? "created_desc");
          let users = authUsers.filter((u) =>
            matches(`${u.email ?? ""} ${u.phone ?? ""} ${u.id}`, a.search),
          );
          if (filter === "confirmed")
            users = users.filter((u) => u.email_confirmed_at || u.phone_confirmed_at);
          if (filter === "unconfirmed")
            users = users.filter(
              (u) => !u.email_confirmed_at && !u.phone_confirmed_at && !u.is_anonymous,
            );
          if (filter === "anonymous") users = users.filter((u) => u.is_anonymous);
          if (filter === "banned") users = users.filter((u) => u.banned_until);
          const key = sort.startsWith("last_sign_in")
            ? "last_sign_in_at"
            : sort === "email_asc"
              ? "email"
              : "created_at";
          users = [...users].sort(
            (x, y) =>
              String(x[key] ?? "").localeCompare(String(y[key] ?? "")) *
              (sort.endsWith("desc") ? -1 : 1),
          );
          return { users, has_more: false, total: users.length, server_side: true };
        }
        case "supabase_studio_auth_user":
        case "supabase_studio_auth_update_user": {
          const u = authUsers.find((x) => x.id === a.userId) ?? authUsers[0];
          return {
            id: u.id,
            aud: "authenticated",
            role: "authenticated",
            email: u.email ?? undefined,
            phone: u.phone ?? undefined,
            email_confirmed_at: u.email_confirmed_at ?? undefined,
            phone_confirmed_at: u.phone_confirmed_at ?? undefined,
            confirmation_sent_at: u.created_at ?? undefined,
            last_sign_in_at: u.last_sign_in_at ?? undefined,
            created_at: u.created_at ?? undefined,
            updated_at: u.last_sign_in_at ?? u.created_at ?? undefined,
            banned_until: u.banned_until ?? undefined,
            is_anonymous: !!u.is_anonymous,
            is_sso_user: false,
            app_metadata: { provider: u.providers[0], providers: u.providers, roles: ["customer"] },
            user_metadata: {
              full_name: u.email?.split("@")[0].replace(".", " "),
              avatar_url: `https://${REF}.supabase.co/storage/v1/object/public/avatars/users/${u.id}.png`,
            },
            identities: u.providers.map((p, i) => ({
              identity_id: uuid(1500 + i),
              id: u.id,
              provider: p,
              email: u.email ?? undefined,
              created_at: u.created_at ?? undefined,
              last_sign_in_at: u.last_sign_in_at ?? undefined,
              updated_at: u.created_at ?? undefined,
            })),
            factors:
              authUsers.indexOf(u) % 3 === 0
                ? [
                    {
                      id: uuid(1600),
                      friendly_name: "Authenticator",
                      factor_type: "totp",
                      status: "verified",
                      created_at: u.created_at ?? undefined,
                    },
                  ]
                : [],
          };
        }
        case "supabase_studio_auth_create_user":
        case "supabase_studio_auth_invite":
          return {
            id: uuid(1700),
            email: String(
              ((a.attributes as Record<string, unknown>)?.email ?? a.email) || "neu@acme.io",
            ),
            created_at: iso(NOW),
          };
        case "supabase_studio_auth_generate_link":
          return {
            action_link: `https://${REF}.supabase.co/auth/v1/verify?token=pkce_8f1c2d&type=magiclink&redirect_to=https://app.acme.io`,
            email_otp: "482913",
            hashed_token: "c0ffee8f1c2d",
            verification_type: String(a.kind ?? "magiclink"),
            redirect_to: "https://app.acme.io",
          };
        case "supabase_studio_auth_sign_out_user":
          return { sessions: 2, refresh_tokens: 5 };
        case "supabase_studio_auth_settings":
          return {
            external: {
              email: true,
              phone: true,
              anonymous_users: true,
              google: true,
              github: true,
              apple: true,
              azure: false,
              discord: false,
              gitlab: false,
              twitter: false,
            },
            disable_signup: false,
            mailer_autoconfirm: false,
            phone_autoconfirm: false,
            sms_provider: "twilio",
            saml_enabled: false,
          };
        case "supabase_studio_auth_config":
        case "supabase_studio_auth_update_config":
          return { ...AUTH_CONFIG, ...((a.patch as object) ?? {}) };

        case "supabase_studio_storage_buckets":
          return { buckets: BUCKETS.filter((b) => matches(b.name, a.search)), has_more: false };
        case "supabase_studio_storage_objects":
          return {
            objects: listObjects(String(a.bucket), String(a.prefix ?? ""), String(a.search ?? "")),
            has_more: false,
          };
        case "supabase_studio_storage_upload":
          return { uploaded: ["neu.png"], failed: [] };
        case "supabase_studio_storage_create_folder":
          return `${a.prefix ?? ""}${a.name}/`;
        case "supabase_studio_storage_transfer":
        case "supabase_studio_storage_delete":
          return Array.isArray(a.paths) ? a.paths.length : 1;
        case "supabase_studio_storage_signed_url":
          return `https://${REF}.supabase.co/storage/v1/object/sign/${a.bucket}/${a.objectKey}?token=eyJhbGciOiJIUzI1NiJ9.mock`;
        case "supabase_studio_storage_public_url":
          return `https://${REF}.supabase.co/storage/v1/object/public/${a.bucket}/${a.objectKey}`;
        case "supabase_studio_storage_object_info": {
          const key = String(a.objectKey);
          const entry = (FILES[String(a.bucket)] ?? []).find(([p]) => p === key);
          return {
            id: uuid(key.length),
            name: key,
            version: uuid(key.length + 1),
            bucket_id: String(a.bucket),
            size: entry?.[2] ?? 0,
            content_type: entry?.[1] ?? "application/octet-stream",
            cache_control: "max-age=3600",
            content_encoding: null,
            etag: `"${uuid(key.length + 2).slice(0, 12)}"`,
            metadata: { owner: authUsers[0].id },
            last_modified: iso(NOW - 3 * DAY),
            created_at: iso(NOW - 40 * DAY),
          };
        }

        case "supabase_studio_edge_function":
        case "supabase_studio_edge_function_update":
        case "supabase_studio_edge_function_deploy":
          return functionDetails(String(a.slug));
        case "supabase_studio_edge_function_source": {
          const f = FUNCTIONS.find((x) => x.slug === a.slug) ?? FUNCTIONS[0];
          const files = [
            { path: `${f.slug}/index.ts`, content: f.body, size: f.body.length },
            {
              path: `${f.slug}/deno.json`,
              content: `{\n  "imports": {\n    "@supabase/supabase-js": "jsr:@supabase/supabase-js@2"\n  }\n}\n`,
              size: 74,
            },
            {
              path: "_shared/cors.ts",
              content: `export const corsHeaders = {\n  "Access-Control-Allow-Origin": "*",\n  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",\n};\n`,
              size: 148,
            },
          ];
          return { format: "files", files, size: files.reduce((sum, file) => sum + file.size, 0) };
        }
        case "supabase_studio_edge_function_download":
          return `/home/user/Downloads/${a.slug}.zip`;
        case "supabase_studio_edge_secrets":
          return [
            "STRIPE_SECRET_KEY",
            "STRIPE_WEBHOOK_SECRET",
            "RESEND_API_KEY",
            "OPENAI_API_KEY",
            "SUPABASE_URL",
            "SUPABASE_ANON_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_DB_URL",
          ].map((name, i) => ({
            name,
            value: `${uuid(1800 + i)
              .replace(/-/g, "")
              .slice(0, 24)}`,
            updated_at: iso(NOW - (i * 9 + 2) * DAY),
          }));
        case "supabase_studio_edge_invoke":
          return {
            status: 200,
            headers: [
              ["content-type", "application/json"],
              ["x-served-by", "supabase-edge-runtime"],
              ["x-deno-execution-id", uuid(1900)],
            ],
            body: JSON.stringify(
              { received: true, id: "evt_1QJx2a", processed_at: iso(NOW) },
              null,
              2,
            ),
            size: 74,
            truncated: false,
            duration_ms: 142,
          };
        case "supabase_studio_edge_realtime_open": {
          const channel = a.events as { id?: number } | undefined;
          const send = (index: number, message: unknown) => {
            const fn =
              channel?.id === undefined
                ? undefined
                : (window as unknown as Record<string, (m: unknown) => void>)[`_${channel.id}`];
            fn?.({ index, message });
          };
          setTimeout(() => {
            send(0, { kind: "status", status: "open", detail: null });
            for (const [i, type] of ["INSERT", "UPDATE", "UPDATE", "DELETE", "INSERT"].entries())
              send(i + 1, {
                kind: "message",
                event: "postgres_changes",
                payload: {
                  data: {
                    type,
                    schema: "public",
                    table: "orders",
                    commit_timestamp: iso(NOW - i * 4000),
                    record: {
                      id: 18_930 - i,
                      status: pick(["pending", "paid", "shipped"], i),
                      total: 129.9 + i * 10,
                    },
                  },
                },
                received_at: NOW - i * 4000,
              });
          }, 300);
          return null;
        }
        case "supabase_studio_edge_publication_tables":
          return {
            publication: {
              all_tables: false,
              insert: true,
              update: true,
              delete: true,
              truncate: false,
            },
            tables: TABLES.filter((t) => matches(t.name, a.search)).map((t) => ({
              schema: "public",
              name: t.name,
              enabled: ["orders", "order_items", "reviews", "profiles"].includes(t.name),
            })),
            has_more: false,
          };

        case "supabase_studio_observability_sessions":
          return {
            rows: Array.from({ length: a.includeIdle ? 14 : 8 }, (_, i) => ({
              pid: 41_200 + i * 13,
              usename: pick(
                [
                  "authenticator",
                  "postgres",
                  "supabase_admin",
                  "supabase_auth_admin",
                  "supabase_storage_admin",
                ],
                i,
              ),
              datname: "postgres",
              application_name: pick(
                ["postgrest", "Supavisor", "realtime", "pg_cron scheduler", "psql", "l8db"],
                i,
              ),
              client_addr: `10.0.${i}.${20 + i}`,
              backend_type: "client backend",
              state: i < 5 ? "active" : i < 7 ? "idle in transaction" : "idle",
              wait_event_type: i === 2 ? "Lock" : i === 4 ? "IO" : null,
              wait_event: i === 2 ? "relation" : i === 4 ? "DataFileRead" : null,
              query: STATEMENTS[i % STATEMENTS.length][0],
              backend_start: iso(NOW - (i + 1) * 3_600_000),
              query_start: iso(NOW - i * 1700),
              xact_start: iso(NOW - i * 2100),
              duration_ms: i * 1700 + 12,
              xact_ms: i * 2100 + 20,
              blocked_by: i === 2 ? [41_200 + 13 * 5] : [],
            })),
            has_more: false,
          };
        case "supabase_studio_observability_signal":
          return true;
        case "supabase_studio_observability_locks":
          return {
            blocked: {
              rows: [
                {
                  pid: 41_226,
                  usename: "authenticator",
                  state: "active",
                  wait_event_type: "Lock",
                  wait_event: "relation",
                  query: "update orders set status = 'shipped' where id = 18920",
                  waiting_ms: 8_412,
                  blocked_by: [41_265],
                  blockers: [
                    {
                      pid: 41_265,
                      usename: "postgres",
                      state: "idle in transaction",
                      query: "lock table orders in share row exclusive mode",
                    },
                  ],
                },
              ],
              has_more: false,
            },
            locks: {
              rows: Array.from({ length: 12 }, (_, i) => ({
                pid: 41_200 + (i % 6) * 13,
                locktype: pick(["relation", "transactionid", "virtualxid", "relation"], i),
                mode: pick(
                  ["AccessShareLock", "RowExclusiveLock", "ShareRowExclusiveLock", "ExclusiveLock"],
                  i,
                ),
                granted: i !== 3,
                relation: i % 4 === 1 ? null : `public.${TABLES[i % TABLES.length].name}`,
                transaction_id: i % 4 === 1 ? String(882_100 + i) : null,
                usename: "authenticator",
                state: "active",
                query: STATEMENTS[i % STATEMENTS.length][0],
              })),
              has_more: false,
            },
          };
        case "supabase_studio_observability_statements": {
          const order = String(a.order ?? "total");
          const rows = STATEMENTS.map(([query, role, calls, mean, max, rows], i) => ({
            queryid: String(-8_812_331_002 + i * 77_133),
            query,
            role,
            calls,
            total_ms: calls * mean,
            mean_ms: mean,
            max_ms: max,
            rows,
            shared_blks_hit: Math.floor(calls * 14 * rand(i)),
            shared_blks_read: Math.floor(calls * 0.4 * rand(i + 1)),
          }));
          const field =
            (
              {
                total: "total_ms",
                mean: "mean_ms",
                max: "max_ms",
                calls: "calls",
                rows: "rows",
              } as const
            )[order as "total"] ?? "total_ms";
          rows.sort((x, y) => Number(y[field]) - Number(x[field]));
          return {
            installed: true,
            available: true,
            schema: "extensions",
            page: { rows, has_more: false },
          };
        }
        case "supabase_studio_observability_health":
          return {
            database_size: 2_412_331_008,
            max_connections: 160,
            table_hit_ratio: 0.9971,
            index_hit_ratio: 0.9934,
            connections: {
              rows: [
                { role: "authenticator", state: "active", count: 6 },
                { role: "authenticator", state: "idle", count: 31 },
                { role: "supabase_admin", state: "idle", count: 9 },
                { role: "postgres", state: "idle in transaction", count: 2 },
                { role: "supabase_auth_admin", state: "idle", count: 5 },
                { role: "supabase_storage_admin", state: "idle", count: 4 },
              ],
              has_more: false,
            },
            long_transactions: {
              rows: [
                {
                  pid: 41_265,
                  usename: "postgres",
                  state: "idle in transaction",
                  query: "lock table orders in share row exclusive mode",
                  xact_start: iso(NOW - 412_000),
                  xact_ms: 412_000,
                },
                {
                  pid: 41_291,
                  usename: "authenticator",
                  state: "active",
                  query: "select public.monthly_revenue(2026)",
                  xact_start: iso(NOW - 64_000),
                  xact_ms: 64_000,
                },
              ],
              has_more: false,
            },
            replication_slots: {
              rows: [
                {
                  slot_name: "supabase_realtime_replication_slot",
                  plugin: "wal2json",
                  slot_type: "logical",
                  database: "postgres",
                  active: true,
                  active_pid: 1_211,
                  retained_wal: "18 MB",
                  retained_bytes: 18_874_368,
                },
                {
                  slot_name: "analytics_cdc",
                  plugin: "pgoutput",
                  slot_type: "logical",
                  database: "postgres",
                  active: false,
                  active_pid: null,
                  retained_wal: "1.4 GB",
                  retained_bytes: 1_503_238_553,
                },
              ],
              has_more: false,
            },
          };
        case "supabase_studio_observability_sizes": {
          const tables = allTables()
            .map((t, i) => {
              const table = Math.floor(t.rows * (180 + rand(i) * 400));
              const index = Math.floor(table * (0.2 + rand(i + 1) * 0.5));
              return {
                schema: t.schema,
                name: t.name,
                estimated_rows: t.rows,
                total_bytes: table + index + 8192,
                table_bytes: table,
                index_bytes: index,
              };
            })
            .sort((x, y) => y.total_bytes - x.total_bytes);
          const indexes = databaseList({ kind: "indexes" }).items as {
            schema: string;
            table_name: string;
            name: string;
            size_bytes: number;
            scans: number;
            definition: string;
            is_primary: boolean;
            is_unique: boolean;
          }[];
          return {
            tables: { rows: tables, has_more: false },
            indexes: {
              rows: indexes
                .map((ix) => ({
                  schema: ix.schema,
                  table: ix.table_name,
                  name: ix.name,
                  bytes: ix.size_bytes,
                  scans: ix.scans,
                }))
                .sort((x, y) => y.bytes - x.bytes)
                .slice(0, 25),
              has_more: false,
            },
            unused_indexes: {
              rows: indexes
                .filter((ix) => ix.scans === 0 && !ix.is_primary && !ix.is_unique)
                .map((ix) => ({
                  schema: ix.schema,
                  table: ix.table_name,
                  name: ix.name,
                  bytes: ix.size_bytes,
                  scans: 0,
                  definition: ix.definition,
                })),
              has_more: false,
            },
          };
        }
        case "supabase_studio_observability_logs":
          return logRows(
            String(a.source),
            String(a.level ?? ""),
            String(a.search ?? ""),
            Number(a.limit ?? 100),
          );
        case "supabase_studio_observability_advisors":
          return a.kind === "security"
            ? {
                rows: [
                  {
                    name: "rls_disabled_in_public",
                    title: "RLS Disabled in Public",
                    level: "ERROR",
                    facing: "EXTERNAL",
                    categories: ["SECURITY"],
                    description:
                      "Detects cases where row level security (RLS) has not been enabled on tables in schemas exposed to PostgREST",
                    detail: "Table `public.categories` is public, but RLS has not been enabled.",
                    remediation:
                      "https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public",
                    metadata: { schema: "public", name: "categories", type: "table" },
                    cache_key: "rls_disabled_in_public_public_categories",
                  },
                  {
                    name: "rls_disabled_in_public",
                    title: "RLS Disabled in Public",
                    level: "ERROR",
                    facing: "EXTERNAL",
                    categories: ["SECURITY"],
                    description:
                      "Detects cases where row level security (RLS) has not been enabled on tables in schemas exposed to PostgREST",
                    detail: "Table `public.coupons` is public, but RLS has not been enabled.",
                    remediation:
                      "https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public",
                    metadata: { schema: "public", name: "coupons", type: "table" },
                    cache_key: "rls_disabled_in_public_public_coupons",
                  },
                  {
                    name: "function_search_path_mutable",
                    title: "Function Search Path Mutable",
                    level: "WARN",
                    facing: "EXTERNAL",
                    categories: ["SECURITY"],
                    description: "Detects functions where the search_path parameter is not set.",
                    detail: "Function `public.apply_coupon` has a role mutable search_path",
                    remediation:
                      "https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable",
                    metadata: { schema: "public", name: "apply_coupon", type: "function" },
                    cache_key: "function_search_path_mutable_public_apply_coupon",
                  },
                  {
                    name: "auth_leaked_password_protection",
                    title: "Leaked Password Protection Disabled",
                    level: "WARN",
                    facing: "EXTERNAL",
                    categories: ["SECURITY"],
                    description: "Leaked password protection is currently disabled.",
                    detail:
                      "Supabase Auth prevents the use of compromised passwords by checking against HaveIBeenPwned.org.",
                    remediation: "https://supabase.com/docs/guides/auth/password-security",
                    cache_key: "auth_leaked_password_protection",
                  },
                  {
                    name: "rls_enabled_no_policy",
                    title: "RLS Enabled No Policy",
                    level: "INFO",
                    facing: "EXTERNAL",
                    categories: ["SECURITY"],
                    description:
                      "Detects cases where row level security (RLS) has been enabled on a table but no RLS policies have been created.",
                    detail: "Table `public.addresses` has RLS enabled, but no policies exist",
                    remediation:
                      "https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy",
                    metadata: { schema: "public", name: "addresses", type: "table" },
                    cache_key: "rls_enabled_no_policy_public_addresses",
                  },
                ],
                has_more: false,
              }
            : {
                rows: [
                  {
                    name: "unindexed_foreign_keys",
                    title: "Unindexed foreign keys",
                    level: "INFO",
                    facing: "EXTERNAL",
                    categories: ["PERFORMANCE"],
                    description:
                      "Identifies foreign key constraints without a covering index, which can impact database performance.",
                    detail:
                      "Table `public.reviews` has a foreign key `reviews_author_id_fkey` without a covering index.",
                    remediation:
                      "https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys",
                    cache_key: "unindexed_foreign_keys_public_reviews",
                  },
                  {
                    name: "auth_rls_initplan",
                    title: "Auth RLS Initialization Plan",
                    level: "WARN",
                    facing: "EXTERNAL",
                    categories: ["PERFORMANCE"],
                    description:
                      "Detects if calls to `auth.<function>()` in RLS policies are being unnecessarily re-evaluated for each row",
                    detail:
                      "Table `public.customers` has a row level security policy `Kunden sehen sich selbst` that re-evaluates auth.email() for each row.",
                    remediation:
                      "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
                    cache_key: "auth_rls_initplan_public_customers",
                  },
                  {
                    name: "unused_index",
                    title: "Unused Index",
                    level: "INFO",
                    facing: "EXTERNAL",
                    categories: ["PERFORMANCE"],
                    description:
                      "Detects if an index has never been used and may be a candidate for removal.",
                    detail:
                      "Index `audit_log_created_at_idx` on table `public.audit_log` has not been used",
                    remediation:
                      "https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index",
                    cache_key: "unused_index_public_audit_log",
                  },
                  {
                    name: "multiple_permissive_policies",
                    title: "Multiple Permissive Policies",
                    level: "WARN",
                    facing: "EXTERNAL",
                    categories: ["PERFORMANCE"],
                    description:
                      "Detects if multiple permissive row level security policies are present on a table for the same role and action.",
                    detail:
                      "Table `public.products` has multiple permissive policies for role `authenticated` for action `SELECT`.",
                    remediation:
                      "https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies",
                    cache_key: "multiple_permissive_policies_public_products",
                  },
                ],
                has_more: false,
              };
        case "supabase_studio_observability_usage": {
          const step =
            (
              {
                "15min": 60_000,
                "30min": 120_000,
                "1hr": 300_000,
                "3hr": 900_000,
                "1day": 3_600_000,
                "3day": 10_800_000,
                "7day": 21_600_000,
              } as Record<string, number>
            )[String(a.interval)] ?? 3_600_000;
          return {
            rows: Array.from({ length: 24 }, (_, i) => {
              const wave = 0.6 + 0.4 * Math.sin(i / 3.5);
              return {
                timestamp: iso(NOW - (23 - i) * step),
                total_auth_requests: Math.round(300 * wave + rand(i) * 80),
                total_rest_requests: Math.round(4200 * wave + rand(i + 1) * 900),
                total_storage_requests: Math.round(900 * wave + rand(i + 2) * 200),
                total_realtime_requests: Math.round(150 * wave + rand(i + 3) * 60),
              };
            }),
            has_more: false,
          };
        }

        case "supabase_studio_settings_overview_stats":
          return {
            database_size: 2_412_331_008,
            table_count: TABLES.length,
            auth_user_count: 1284,
            bucket_count: BUCKETS.length,
            function_count: FUNCTIONS.length,
            limit: 100_000,
            errors: [],
          };
        case "supabase_studio_settings_reveal_key":
          return "mock-secret-key-for-ui-tests";
        case "supabase_studio_settings_api_keys":
          return [
            {
              name: "anon",
              type: "legacy",
              api_key:
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3BxcnN0Iiwicm9sZSI6ImFub24ifQ.x3H4n0",
            },
            {
              name: "service_role",
              type: "legacy",
              api_key:
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3BxcnN0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.q9Zk2m",
            },
            {
              name: "default",
              type: "publishable",
              api_key: "mock-publishable-key-for-ui-tests",
            },
            { name: "backend", type: "secret", api_key: "mock-sec••••••••••••" },
          ];
        case "supabase_studio_settings_postgrest":
        case "supabase_studio_settings_update_postgrest":
          return {
            db_schema: "public,graphql_public,storage",
            max_rows: 1000,
            db_extra_search_path: "public,extensions",
            db_pool: null,
          };
        case "supabase_studio_settings_postgres_config":
        case "supabase_studio_settings_update_postgres_config":
          return {
            max_connections: 160,
            shared_buffers: "1GB",
            effective_cache_size: "3GB",
            work_mem: "8MB",
            maintenance_work_mem: "256MB",
            statement_timeout: "8s",
            checkpoint_timeout: "5min",
            max_wal_size: "4GB",
            max_worker_processes: 8,
            max_parallel_workers: 4,
            max_parallel_workers_per_gather: 2,
            max_locks_per_transaction: 64,
            session_replication_role: "origin",
          };
        case "supabase_studio_settings_pooler":
          return [
            {
              identifier: REF,
              database_type: "PRIMARY",
              db_user: `postgres.${REF}`,
              db_host: "aws-0-eu-central-1.pooler.supabase.com",
              db_port: 6543,
              db_name: "postgres",
              pool_mode: "transaction",
              default_pool_size: 20,
              max_client_conn: 400,
              connection_string: `postgresql://postgres.${REF}:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
            },
            {
              identifier: REF,
              database_type: "PRIMARY",
              db_user: `postgres.${REF}`,
              db_host: "aws-0-eu-central-1.pooler.supabase.com",
              db_port: 5432,
              db_name: "postgres",
              pool_mode: "session",
              default_pool_size: 20,
              max_client_conn: 400,
              connection_string: `postgresql://postgres.${REF}:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
            },
          ];
        case "supabase_studio_settings_ssl_enforcement":
        case "supabase_studio_settings_update_ssl_enforcement":
          return { currentConfig: { database: true }, appliedSuccessfully: true };
        case "supabase_studio_settings_network_restrictions":
          return {
            entitlement: "allowed",
            status: "applied",
            config: { dbAllowedCidrs: ["0.0.0.0/0"], dbAllowedCidrsV6: ["::/0"] },
          };

        case "plugin:event|listen":
          return Math.floor(Math.random() * 1e6);
        case "plugin:app|version":
          return "0.42.0";
        case "plugin:app|name":
          return "l8db";
        case "plugin:os|platform":
          return "linux";
        case "list_databases":
        case "list_schemas":
        case "list_tables":
        case "appwrite_profiles":
        case "pocketbase_profiles":
        case "convex_profiles":
        case "firebase_profiles":
          return [];
        default:
          return null;
      }
    };
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { windowLabel: "main", label: "main" },
        },
        transformCallback: (callback: unknown) => {
          const id = Math.floor(Math.random() * 1e9);
          Object.assign(window, { [`_${id}`]: callback });
          return id;
        },
        unregisterCallback: (id: number) => {
          delete (window as unknown as Record<string, unknown>)[`_${id}`];
        },
        convertFileSrc: (path: string) => path,
        invoke: async (command: string, args: Record<string, unknown> | undefined) => {
          const result = await invoke(command, args ?? {});
          if (result === null && !command.startsWith("supabase")) {
            const record = window as unknown as { __mockUnknown?: Set<string> };
            record.__mockUnknown ??= new Set();
            record.__mockUnknown.add(command);
          }
          return result;
        },
      },
    });
  });

  await page.route("**/blog/feed.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, generatedAt: "2026-10-25T00:00:00Z", items: [] }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "l8db.settings",
      JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 1 }),
    );
  });
}
