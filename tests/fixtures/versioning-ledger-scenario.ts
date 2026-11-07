export async function runLedgerScenario(repo: string, kind: "postgres" | "oracle") {
  const model = await import("/src/lib/versioning/model.ts");
  const api = await import("/src/lib/versioning/repository.ts");
  const db = await import("/src/lib/db/index.ts");
  const capture = await import("/src/lib/versioning/capture.ts");
  const deployment = await import("/src/lib/versioning/deploy.ts");
  const ledger = await import("/src/lib/versioning/ledger.ts");
  const scripts = await import("/src/lib/versioning/migration-script.ts");
  const pg = kind === "postgres";
  const connection = pg
    ? {
        id: "Development",
        name: "Development",
        kind,
        connectionString: "postgresql://lab@127.0.0.1:55440/l8db_versioning_dev",
        sslMode: "disable",
      }
    : {
        id: "Oracle Lab",
        name: "Oracle Lab",
        kind,
        connectionString: "oracle://lab@127.0.0.1:55441/FREEPDB1",
        sslMode: "disable",
      };
  const place = (database: string, schema: string) => ({ database: pg ? database : null, schema });
  const dev = place("l8db_versioning_dev", pg ? "public" : "L8DB_DEV");
  const customers = {
    a: { name: "Kunde A", ...place("l8db_versioning_a", pg ? "public" : "L8DB_CUSTOMER_A") },
    b: { name: "Kunde B", ...place("l8db_versioning_b", pg ? "public" : "L8DB_CUSTOMER_B") },
    c: { name: "LEGACY_1", ...place("l8db_versioning_edge", pg ? "public" : "L8DB_LEGACY_1") },
  };
  const name = (value: string) => (pg ? value : value.toUpperCase());
  const q = (at: { schema: string }, value: string) =>
    pg ? `public.${value}` : `"${at.schema}"."${name(value)}"`;
  const exec = async (at: { database: string | null }, sql: string, tolerant = false) => {
    const results = await db.executeScript(
      kind,
      connection.connectionString,
      sql,
      at.database ?? undefined,
      { confirmed: true },
    );
    const failed = results.find((result) => !result.success);
    if (failed && !tolerant) throw new Error(failed.error ?? "SQL fehlgeschlagen");
  };
  const query = async (at: { database: string | null }, sql: string) =>
    (
      await db.executeQuery(kind, connection.connectionString, sql, at.database ?? undefined, {
        confirmed: true,
      })
    ).rows;
  const objects = [
    { id: "invoices", objectType: "table", objectName: name("lab_invoices") },
    { id: "currencies", objectType: "table", objectName: name("lab_currencies") },
  ].map((entry) => ({
    id: entry.id,
    path: `database/objects/${entry.id}.sql`,
    metadataVersion: 3,
    selection: {
      schema: dev.schema,
      objectType: entry.objectType,
      objectName: entry.objectName,
      objectOid: null,
    },
  }));
  const reset = async (at: { database: string | null; schema: string }) => {
    for (const suffix of ["LOCKS", "POLICY", "JOURNAL", "APPROVALS", "STATE", "CHANGES", "OBJECTS"])
      await exec(
        at,
        `DROP TABLE ${pg ? "public" : `"${at.schema}"`}."L8DB_VERSIONING_${suffix}"`,
        true,
      );
    await exec(
      at,
      pg ? "DROP FUNCTION public.lab_price(numeric)" : `DROP PACKAGE "${at.schema}"."LAB_PRICE"`,
      true,
    );
    for (const table of ["lab_currencies", "lab_invoices"])
      await exec(at, `DROP TABLE ${q(at, table)}${pg ? " CASCADE" : " CASCADE CONSTRAINTS"}`, true);
    await exec(
      at,
      pg
        ? "CREATE TABLE public.lab_invoices (id integer PRIMARY KEY, amount numeric NOT NULL)"
        : `CREATE TABLE ${q(at, "lab_invoices")} (ID NUMBER PRIMARY KEY, AMOUNT NUMBER NOT NULL)`,
    );
  };
  for (const at of [dev, ...Object.values(customers)]) await reset(at);
  const loaded = await api.loadRepository(repo);
  let project = {
    format: 1,
    id: "ledger-product",
    name: "Ledger Product",
    kind,
    objects: [objects[0]],
  };
  await api.saveFile(repo, model.PROJECT_PATH, api.encode(project), loaded.projectText);
  const commit = async (message: string) => {
    const status = await db.versioningRepository({ action: "status", repo });
    await db.versioningRepository({ action: "commit", repo, paths: status.files, name: message });
  };
  const release = async (
    id: string,
    parents: string[],
    sql: string | null | ({ id: string; sql: string } & Record<string, unknown>)[],
    extra: Record<string, unknown> = {},
    top: Record<string, unknown> = {},
  ) => {
    const snapshots = [];
    for (const object of project.objects)
      snapshots.push(await capture.captureObject(connection, dev.database, object));
    const value = {
      format: 2,
      id,
      projectId: project.id,
      kind,
      parents,
      createdAt: new Date().toISOString(),
      ...top,
      objects: snapshots,
      migrations: Array.isArray(sql)
        ? await Promise.all(
            sql.map(async (entry) => ({
              title: `${entry.id} ${id}`,
              ...entry,
              checksum: await model.checksum(entry.sql),
            })),
          )
        : sql
          ? [{ id: "m", title: `Update ${id}`, sql, checksum: await model.checksum(sql), ...extra }]
          : [],
    };
    await api.saveFile(repo, model.releasePath(id), api.encode(value), null);
    await commit(id);
    return value;
  };
  const targets = Object.entries(customers).map(([id, customer]) => ({
    id,
    name: customer.name,
    connectionId: connection.id,
    database: customer.database,
    schema: customer.schema,
    production: false,
    release: null,
    history: [],
  }));
  await api.saveTargets(
    repo,
    { format: 1, projectId: project.id, targets },
    (await api.readTargets(repo, project.id)).text,
  );
  const target = async (id: string) =>
    (await api.readTargets(repo, project.id)).store.targets.find((entry) => entry.id === id);
  const plan = async (id: string, releaseId: string) =>
    deployment.planDeployment(repo, project, await target(id), connection, releaseId);
  const rollout = async (id: string, releaseId: string) => {
    const planned = await plan(id, releaseId);
    await deployment.deploy(repo, project, id, connection, releaseId, planned.reviewToken);
    return planned;
  };
  const applied = async (id: string) => {
    const entry = await target(id);
    const result = await ledger.readChangeLedger(connection, project, entry);
    return [...(result?.changes.values() ?? [])]
      .map((change) => `${change.id}:${change.source}`)
      .sort();
  };
  const devPlace = dev;
  await release("v1", [], null);
  for (const id of ["a", "b", "c"])
    await deployment.baselineTarget(repo, project, id, connection, "v1");
  const v2 = pg
    ? "ALTER TABLE public.lab_invoices ADD COLUMN note text"
    : `ALTER TABLE ${q(devPlace, "lab_invoices")} ADD (NOTE VARCHAR2(200))`;
  await exec(devPlace, v2);
  await release("v2", ["v1"], v2);
  const v3 = pg
    ? "CREATE INDEX lab_invoices_amount ON public.lab_invoices (amount)"
    : `CREATE INDEX "${dev.schema}"."LAB_INVOICES_AMOUNT" ON ${q(devPlace, "lab_invoices")} (AMOUNT)`;
  await exec(devPlace, v3);
  await release("v3", ["v2"], v3);
  await rollout("b", "v2");
  await rollout("c", "v3");
  project = { ...project, objects };
  await api.saveFile(
    repo,
    model.PROJECT_PATH,
    api.encode(project),
    await api.readFile(repo, model.PROJECT_PATH),
  );
  const v4 = pg
    ? "CREATE TABLE public.lab_currencies (code varchar(3) PRIMARY KEY, label text NOT NULL)"
    : `CREATE TABLE ${q(devPlace, "lab_currencies")} (CODE VARCHAR2(3) PRIMARY KEY, LABEL VARCHAR2(100) NOT NULL)`;
  await exec(devPlace, v4);
  await release("v4", ["v3"], v4);
  const masse = [];
  for (const id of ["a", "b", "c"])
    masse.push((await rollout(id, "v4")).releases.map((entry) => entry.id));
  const again = (await plan("a", "v4")).steps.length;
  const legacy = async (id: string) => {
    const at = customers[id as keyof typeof customers];
    for (const suffix of ["CHANGES", "OBJECTS"])
      await exec(at, `DROP TABLE ${pg ? "public" : `"${at.schema}"`}."L8DB_VERSIONING_${suffix}"`);
    await exec(
      at,
      `UPDATE ${pg ? "public" : `"${at.schema}"`}."L8DB_VERSIONING_STATE" SET "STATUS" = 'ready'`,
    );
  };
  await legacy("a");
  const adopted = (await plan("a", "v4")).steps.length === 0;
  const migrated = await applied("a");
  const data = `INSERT INTO ${q(devPlace, "lab_currencies")} (${name("code")}, ${name("label")}) VALUES ('EUR', 'Euro')`;
  await release("v5", ["v4"], data);
  await rollout("c", "v5");
  await legacy("c");
  let confirmRequired = false;
  try {
    await plan("c", "v5");
  } catch (error) {
    confirmRequired = String(error).includes("Datenänderungen v5/m");
  }
  await deployment.adoptTarget(repo, project, await target("c"), connection);
  await deployment.baselineTarget(repo, project, "c", connection, "v4", true);
  const reconciled = await plan("c", "v5");
  await deployment.deploy(repo, project, "c", connection, "v5", reconciled.reviewToken);
  const euros = await query(
    customers.c,
    `SELECT COUNT(*) AS "n" FROM ${q(customers.c, "lab_currencies")}`,
  );
  await rollout("b", "v5");
  const hotfix = pg
    ? "CREATE INDEX lab_invoices_note ON public.lab_invoices (note)"
    : `CREATE INDEX "${dev.schema}"."LAB_INVOICES_NOTE" ON ${q(devPlace, "lab_invoices")} (NOTE)`;
  await exec(devPlace, hotfix);
  const v51 = await release("v5.1", ["v5"], hotfix);
  await rollout("b", "v5.1");
  const v6 = pg
    ? "ALTER TABLE public.lab_currencies ADD COLUMN symbol text"
    : `ALTER TABLE ${q(devPlace, "lab_currencies")} ADD (SYMBOL VARCHAR2(5))`;
  await exec(devPlace, v6);
  const currencies = v51.objects.find((entry) => entry.object.id === "currencies");
  await release("v6", ["v5", "v5.1"], v6, {
    touches: ["currencies"],
    before: { currencies: currencies?.checksum },
  });
  const progress = (await import("/src/lib/versioning/workflow.ts")).targetProgress;
  const releases = await api.loadReleases(repo, project);
  const shownBefore = progress(
    await target("b"),
    releases,
    await db.versioningRepository({ action: "status", repo }),
  ).label;
  const hotfixPlan = await rollout("b", "v6");
  const catchUp = await rollout("a", "v6");
  const codeObject = pg
    ? {
        id: "price",
        path: "database/objects/price.sql",
        selection: {
          schema: dev.schema,
          objectType: "routine",
          objectName: "lab_price(numeric)",
          objectOid: null,
        },
      }
    : {
        id: "price",
        path: "database/objects/price.pks",
        bodyPath: "database/objects/price.pkb",
        selection: {
          schema: dev.schema,
          objectType: "package",
          objectName: "LAB_PRICE",
          objectOid: null,
        },
      };
  const price = (at: { schema: string }, factor: number) =>
    pg
      ? [
          `CREATE OR REPLACE FUNCTION public.lab_price(numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT $1 * ${factor} $$`,
        ]
      : [
          `CREATE OR REPLACE PACKAGE "${at.schema}"."LAB_PRICE" AS FUNCTION total(value NUMBER) RETURN NUMBER; END LAB_PRICE;`,
          `CREATE OR REPLACE PACKAGE BODY "${at.schema}"."LAB_PRICE" AS FUNCTION total(value NUMBER) RETURN NUMBER IS BEGIN RETURN value * ${factor}; END; END LAB_PRICE;`,
        ];
  const script = (statements: string[]) =>
    pg ? statements.join(";\n") : `${statements.join("\n/\n")}\n/`;
  project = { ...project, objects: [...objects, codeObject] };
  await api.saveFile(
    repo,
    model.PROJECT_PATH,
    api.encode(project),
    await api.readFile(repo, model.PROJECT_PATH),
  );
  for (const statement of price(dev, 1)) await exec(dev, statement);
  await release("v7", ["v6"], script(price(dev, 1)));
  for (const id of ["a", "b", "c"]) await rollout(id, "v7");
  const legacyAt = customers.c;
  for (const suffix of ["LOCKS", "POLICY", "JOURNAL", "APPROVALS", "STATE", "CHANGES", "OBJECTS"])
    await exec(
      legacyAt,
      `DROP TABLE ${pg ? "public" : `"${legacyAt.schema}"`}."L8DB_VERSIONING_${suffix}"`,
    );
  const stored = await api.readTargets(repo, project.id);
  stored.store.targets = stored.store.targets.map((entry) =>
    entry.id === "c" ? { ...entry, release: null, history: [] } : entry,
  );
  await api.saveTargets(repo, stored.store, stored.text);
  await exec(
    legacyAt,
    pg
      ? "ALTER TABLE public.lab_invoices ADD COLUMN legacy_ref text"
      : `ALTER TABLE ${q(legacyAt, "lab_invoices")} ADD (LEGACY_REF VARCHAR2(20))`,
  );
  for (const statement of price(legacyAt, 7)) await exec(legacyAt, statement);
  const fingerprint = async () => {
    const result: Record<string, string> = {};
    for (const object of project.objects)
      result[object.id] = (
        await capture.captureObject(connection, legacyAt.database, object, legacyAt.schema)
      ).checksum;
    return result;
  };
  const legacyBefore = await fingerprint();
  const classified = await deployment.classifyTarget(
    repo,
    project,
    await target("c"),
    connection,
    "v7",
  );
  await deployment.baselineTarget(repo, project, "c", connection, "v7", false, [connection], {
    done: classified.changes
      .filter((entry) => entry.status === "done" || entry.suggested === "done")
      .map((entry) => entry.id),
    variances: classified.variances.map((variance) => ({
      ...variance,
      reason: "Kundenlogik LEGACY_1",
    })),
  });
  const legacyBaseline = await fingerprint();
  await commit("Abweichungen LEGACY_1");
  const v8 = pg
    ? "ALTER TABLE public.lab_currencies ADD COLUMN rate numeric"
    : `ALTER TABLE ${q(devPlace, "lab_currencies")} ADD (RATE NUMBER)`;
  await exec(devPlace, v8);
  await release("v8", ["v7"], v8);
  const legacyRun = (await rollout("c", "v8")).changes.map((change) => change.id);
  const legacyAfter = await fingerprint();
  const legacyTarget = await target("c");
  const legacyShown = progress(
    legacyTarget,
    await api.loadReleases(repo, project),
    await db.versioningRepository({ action: "status", repo }),
  ).label;
  const snapshotOf = (
    releaseValue: { objects: { object: { id: string }; checksum: string }[] },
    id: string,
  ) => releaseValue.objects.find((entry) => entry.object.id === id)?.checksum;
  const codeAt = async (at: { database: string | null; schema: string }) =>
    (await capture.captureObject(connection, at.database, codeObject, at.schema)).checksum;
  const v8Release = JSON.parse((await api.readFile(repo, model.releasePath("v8"))) ?? "{}");
  const column = pg
    ? "ALTER TABLE public.lab_invoices ADD COLUMN status text"
    : `ALTER TABLE ${q(devPlace, "lab_invoices")} ADD (STATUS VARCHAR2(20))`;
  await exec(devPlace, column);
  for (const statement of price(dev, 2)) await exec(dev, statement);
  const usd = `INSERT INTO ${q(devPlace, "lab_currencies")} (${name("code")}, ${name("label")}) VALUES ('USD', 'Dollar')`;
  const v9 = await release(
    "v9",
    ["v8"],
    [
      {
        id: "schema",
        sql: column,
        touches: ["invoices"],
        before: { invoices: snapshotOf(v8Release, "invoices") },
      },
      {
        id: "code",
        kind: "repeatable",
        sql: script(price(dev, 2)),
        touches: ["price"],
        before: { price: snapshotOf(v8Release, "price") },
      },
      { id: "data", sql: usd, touches: [], data: true },
    ],
  );
  for (const statement of price(customers.a, 2)) await exec(customers.a, statement);
  const planA = await rollout("a", "v9");
  const planB = await rollout("b", "v9");
  const priceB = (await codeAt(customers.b)) === snapshotOf(v9, "price");
  const usdCount = async (at: { database: string | null; schema: string }) =>
    Number(
      Object.values(
        (
          await query(
            at,
            `SELECT COUNT(*) AS "n" FROM ${q(at, "lab_currencies")} WHERE ${name("code")} = 'USD'`,
          )
        )[0],
      )[0],
    );
  const historyA = (await target("a"))?.history[0] as { skippedChanges?: string[] } | undefined;
  const ticked = async (id: string) =>
    (await applied(id)).filter((entry) => entry.startsWith("v9/")).length;
  const againV9 = (await plan("a", "v9")).steps.length + (await plan("b", "v9")).steps.length;
  for (const statement of price(customers.a, 5)) await exec(customers.a, statement);
  for (const statement of price(customers.b, 5)) await exec(customers.b, statement);
  const directA = await codeAt(customers.a);
  for (const statement of price(dev, 3)) await exec(dev, statement);
  const v10 = await release(
    "v10",
    ["v9"],
    [
      {
        id: "code",
        kind: "repeatable",
        sql: script(price(dev, 3)),
        touches: ["price"],
        before: { price: snapshotOf(v9, "price") },
      },
    ],
  );
  const blocked = await plan("a", "v10");
  let refused = false;
  try {
    await deployment.deploy(repo, project, "a", connection, "v10", blocked.reviewToken);
  } catch {
    refused = true;
  }
  const keptA = (await codeAt(customers.a)) === directA;
  const drift = await import("/src/lib/versioning/code-drift.ts");
  const report = await drift.codeDriftReport(
    repo,
    project,
    (await api.readTargets(repo, project.id)).store.targets,
    [connection],
  );
  await drift.recordCodeVariance(repo, project, "a", connection, "price", "Kundenlogik Kunde A");
  await commit("Abweichung Kunde A");
  const varianceRun = await rollout("a", "v10");
  const overridePlan = await plan("b", "v10");
  const overridden = await deployment.planDeployment(
    repo,
    project,
    await target("b"),
    connection,
    "v10",
    { overrides: ["price"] },
  );
  await deployment.deploy(
    repo,
    project,
    "b",
    connection,
    "v10",
    overridden.reviewToken,
    undefined,
    { overrides: ["price"] },
  );
  const align = await import("/src/lib/versioning/align.ts");
  const draft = await align.alignmentDraft(
    repo,
    project,
    await target("c"),
    connection,
    "v10",
    true,
  );
  await commit((await align.saveAlignment(repo, draft)) && draft.id);
  const single = async (id: string, change: string) => {
    const planned = await deployment.planDeployment(
      repo,
      project,
      await target(id),
      connection,
      change,
      {
        change: true,
      },
    );
    await deployment.deploy(repo, project, id, connection, change, planned.reviewToken, undefined, {
      change: true,
    });
    return planned;
  };
  const aligned = await single("c", draft.id);
  await align.finishAlignment(repo, project, "c", connection);
  await commit("LEGACY_1 zurück auf main");
  const backOnMain = await rollout("c", "v10");
  const alignedTarget = await target("c");
  const alignedShown = progress(
    alignedTarget,
    await api.loadReleases(repo, project),
    await db.versioningRepository({ action: "status", repo }),
  ).label;
  const alignedPrice = (await codeAt(customers.c)) === snapshotOf(v10, "price");
  const changeFiles = await import("/src/lib/versioning/change-files.ts");
  const indexSql = pg
    ? "CREATE INDEX lab_currencies_label ON public.lab_currencies (label)"
    : `CREATE INDEX "${dev.schema}"."LAB_CURRENCIES_LABEL" ON ${q(devPlace, "lab_currencies")} (LABEL)`;
  const indexId = "2026-11-05-index-waehrung";
  await changeFiles.createStandaloneChange(repo, project, {
    id: indexId,
    title: "Index auf Währungsbezeichnung",
    sql: indexSql,
    touches: ["currencies"],
    before: {},
    data: false,
    preconditions: [
      {
        id: "index-fehlt",
        title: "Index fehlt noch",
        sql: pg
          ? "SELECT CASE WHEN COUNT(*) = 0 THEN 'ja' ELSE 'nein' END AS ok FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'lab_currencies_label'"
          : "SELECT CASE WHEN COUNT(*) = 0 THEN 'ja' ELSE 'nein' END AS ok FROM all_indexes WHERE owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND index_name = 'LAB_CURRENCIES_LABEL'",
        expected: "ja",
        checksum: "",
      },
    ],
  });
  await commit(indexId);
  const distributed = [];
  for (const id of ["a", "b", "c"])
    distributed.push((await single(id, indexId)).changes.map((change) => change.id));
  let twice = false;
  try {
    await single("a", indexId);
  } catch (error) {
    twice = String(error).includes("bereits abgehakt");
  }
  await exec(devPlace, indexSql);
  await release("v11", ["v10"], null, {}, { changes: [indexId] });
  const v11 = [];
  for (const id of ["a", "b", "c"]) v11.push((await rollout(id, "v11")).changes.length);
  const indexes = [];
  for (const at of [customers.a, customers.b, customers.c])
    indexes.push(
      Number(
        Object.values(
          (
            await query(
              at,
              pg
                ? "SELECT COUNT(*) AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'lab_currencies_label'"
                : `SELECT COUNT(*) AS "n" FROM all_indexes WHERE owner = '${at.schema}' AND index_name = 'LAB_CURRENCIES_LABEL'`,
            )
          )[0],
        )[0],
      ),
    );
  const ticks = [];
  for (const id of ["a", "b", "c"])
    ticks.push((await applied(id)).filter((entry) => entry.startsWith(indexId)).length);
  const v12 = pg
    ? "ALTER TABLE public.lab_currencies ADD COLUMN note text"
    : `ALTER TABLE ${q(devPlace, "lab_currencies")} ADD (NOTE VARCHAR2(200))`;
  await exec(devPlace, v12);
  await release("v12", ["v11"], v12);
  const scripted = await plan("b", "v12");
  const scriptLedger = await scripts.scriptLedger(scripted, project);
  const scriptText = scripts.migrationScript({ ...scripted, ledger: scriptLedger }, project.name);
  for (const statement of [
    scriptLedger?.guard ?? "",
    ...scripted.sql,
    ...(scriptLedger?.statements ?? []),
  ])
    await query(customers.b, statement);
  let guarded = false;
  try {
    await query(customers.b, scriptLedger?.guard ?? "");
  } catch (error) {
    guarded = String(error).includes("l8db:");
  }
  const afterScript = await plan("b", "v12");
  await deployment.baselineTarget(repo, project, "b", connection, "v12", true);
  return {
    script: {
      text: scriptText.includes("'script'") && scriptText.includes("L8DB_VERSIONING_CHANGES"),
      from: afterScript.from.id,
      open: afterScript.changes.length,
      ticks: (await applied("b")).filter((entry) => entry.startsWith("v12/")),
      guarded,
      reconciled: (await target("b"))?.release?.id,
    },
    masse,
    again,
    adopted,
    migrated: migrated.every((entry) => entry.endsWith(":migrated")) && migrated.length === 3,
    confirmRequired,
    euros: Number(Object.values(euros[0])[0]),
    hotfixShown: shownBefore,
    hotfixSteps: hotfixPlan.changes.map((change) => change.id),
    catchUpSteps: catchUp.changes.map((change) => change.id),
    versions: (await api.readTargets(repo, project.id)).store.targets.map(
      (entry) => entry.release?.id,
    ),
    ledgerB: (await applied("b")).length,
    code: {
      skipA: planA.code.map((entry) => `${entry.change}:${entry.action}`),
      applyB: planB.code.map((entry) => `${entry.change}:${entry.action}`),
      skipped: historyA?.skippedChanges ?? [],
      usd: [await usdCount(customers.a), await usdCount(customers.b)],
      tickedA: await ticked("a"),
      tickedB: await ticked("b"),
      again: againV9,
      priceB,
    },
    drift: {
      planned: blocked.drift.map((entry) => entry.id),
      refused,
      keptA,
      report: report.rows
        .filter((row) => row.state === "drift")
        .map((row) => `${row.target}:${row.object}`)
        .sort(),
      varianceRun: varianceRun.code.map((entry) => `${entry.change}:${entry.action}`),
      varianceKept: (await codeAt(customers.a)) === directA,
      withoutOverride: overridePlan.drift.map((entry) => entry.id),
      override: overridden.code.map((entry) => `${entry.change}:${entry.action}`),
      overriddenB: (await codeAt(customers.b)) === snapshotOf(v10, "price"),
    },
    single: { distributed, twice, v11, indexes, ticks },
    align: {
      open: draft.open,
      variances: draft.variances,
      aligned: aligned.changes.map((change) => change.id),
      after: backOnMain.changes.map((change) => change.id),
      variancesLeft: alignedTarget?.variances?.length ?? 0,
      track: alignedTarget?.track ?? "main",
      shown: alignedShown,
      price: alignedPrice,
    },
    legacy: {
      decisions: classified.changes
        .filter((entry) => entry.status === "decision")
        .map((entry) => entry.id)
        .sort(),
      proposed: classified.variances.map((variance) => variance.object).sort(),
      noSql: JSON.stringify(legacyBefore) === JSON.stringify(legacyBaseline),
      run: legacyRun,
      variancesKept:
        legacyAfter.invoices === legacyBefore.invoices &&
        legacyAfter.price === legacyBefore.price &&
        legacyTarget?.variances?.every(
          (variance) => legacyAfter[variance.object] === variance.hash,
        ) === true,
      recorded: legacyTarget?.variances?.length,
      shown: legacyShown,
    },
  };
}
