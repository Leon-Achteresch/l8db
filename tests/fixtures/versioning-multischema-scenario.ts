export async function runMultischemaScenario(repo: string) {
  const db = await import("/src/lib/db/index.ts");
  const model = await import("/src/lib/versioning/model.ts");
  const repository = await import("/src/lib/versioning/repository.ts");
  const capture = await import("/src/lib/versioning/capture.ts");
  const deployment = await import("/src/lib/versioning/deploy.ts");
  const fleet = await import("/src/lib/versioning/fleet.ts");
  const targets = await import("/src/lib/versioning/targets.ts");
  const suffix = repo.split("multischema-").at(-1)?.replace(/\D/g, "").slice(-8);
  if (!suffix) throw new Error("Isolated scenario name missing");
  const sourceSchema = `source_${suffix}`;
  const uiSchema = `tenant_ui_${suffix}`;
  const url = "postgresql://lab@127.0.0.1:55440/l8db_versioning_dev";
  const connections = [
    { id: "primary", name: "Primary", kind: "postgres", connectionString: url, sslMode: "disable" },
    { id: "alias", name: "Alias", kind: "postgres", connectionString: url, sslMode: "disable" },
    {
      id: "other",
      name: "Other",
      kind: "postgres",
      connectionString: "postgresql://lab@127.0.0.1:55440/l8db_versioning_edge",
      sslMode: "disable",
    },
  ];
  const query = (database: string, sql: string) =>
    db.executeQuery("postgres", url, sql, database, { confirmed: true });
  const publicBefore = await query(
    "l8db_versioning_dev",
    "SELECT COUNT(*) AS count FROM public.invoices",
  );
  const object = {
    id: "invoices",
    path: "database/objects/invoices.sql",
    selection: {
      schema: sourceSchema,
      objectType: "table",
      objectName: "invoices",
      objectOid: null,
    },
  };
  const loaded = await repository.loadRepository(repo);
  const project = { ...loaded.project, objects: [object] };
  await repository.saveFile(
    repo,
    model.PROJECT_PATH,
    repository.encode(project),
    loaded.projectText,
  );
  const rows = [
    {
      name: "Kunde Nord",
      database: "l8db_versioning_dev",
      schema: `tenant_nord_${suffix}`,
      amount: 11,
      connection: connections[0],
    },
    {
      name: "Kunde Süd",
      database: "l8db_versioning_dev",
      schema: `tenant_sued_${suffix}`,
      amount: 22,
      connection: connections[1],
    },
    {
      name: "Kunde Ost",
      database: "l8db_versioning_edge",
      schema: `tenant_ost_${suffix}`,
      amount: 33,
      connection: connections[2],
    },
  ];
  await query(rows[0].database, `CREATE SCHEMA ${sourceSchema}`);
  await query(
    rows[0].database,
    `CREATE TABLE ${sourceSchema}.invoices (id integer PRIMARY KEY, amount numeric NOT NULL)`,
  );
  for (const row of rows) {
    await query(row.database, `CREATE SCHEMA ${row.schema}`);
    await query(
      row.database,
      `CREATE TABLE ${row.schema}.invoices (id integer PRIMARY KEY, amount numeric NOT NULL)`,
    );
    await query(row.database, `INSERT INTO ${row.schema}.invoices VALUES (1, ${row.amount})`);
  }
  const source = await capture.captureObject(connections[0], rows[0].database, object);
  await repository.saveFile(repo, object.path, `${source.definition}\n`, null);
  const release = async (id: string, parent: string | null, sql: string) => {
    const snapshot = await capture.captureObject(connections[0], rows[0].database, object);
    const value = {
      format: 1,
      id,
      projectId: project.id,
      kind: "postgres",
      parent,
      createdAt: new Date().toISOString(),
      objects: [snapshot],
      migrations: sql
        ? [{ id: `${id}-migration`, title: id, sql, checksum: await model.checksum(sql) }]
        : [],
    };
    await repository.saveFile(repo, model.releasePath(id), repository.encode(value), null);
    const status = await db.versioningRepository({ action: "status", repo });
    await db.versioningRepository({ action: "commit", repo, paths: status.files, name: id });
  };
  await release("v1", null, "");
  const created = [];
  for (const row of rows) {
    created.push(
      await targets.addTarget(repo, project, connections, {
        name: row.name,
        connectionId: row.connection.id,
        database: row.database,
        schema: row.schema,
        production: false,
      }),
    );
  }
  let duplicateBlocked = false;
  try {
    await targets.addTarget(repo, project, connections, {
      name: "Falscher Alias",
      connectionId: "alias",
      database: rows[0].database,
      schema: rows[0].schema,
      production: false,
    });
  } catch (error) {
    duplicateBlocked = String(error).includes("dieselbe Datenbank und dasselbe Schema");
  }
  for (const [index, row] of rows.entries())
    await deployment.baselineTarget(
      repo,
      project,
      created[index].id,
      row.connection,
      "v1",
      false,
      connections,
    );
  const sql = `ALTER TABLE ${sourceSchema}.invoices ADD COLUMN note text`;
  await query(rows[0].database, sql);
  await release("v2", "v1", sql);
  const stored = (await repository.readTargets(repo, project.id)).store.targets;
  const before = await fleet.preflightFleet(repo, project, stored, connections, "v2");
  await fleet.deployFleet(
    repo,
    project,
    before.map((entry) => entry.plan),
    connections,
    "v2",
    undefined,
    1,
  );
  const afterCanary = [];
  for (const row of rows) {
    const result = await query(
      row.database,
      `SELECT amount FROM ${row.schema}.invoices WHERE id = 1`,
    );
    const columns = await db.listTableColumnsDetailed(
      "postgres",
      url,
      row.schema,
      "invoices",
      row.database,
    );
    afterCanary.push({
      amount: Number(result.rows[0].amount),
      note: columns.some((column) => column.name === "note"),
    });
  }
  const remaining = (await repository.readTargets(repo, project.id)).store.targets.slice(1);
  const next = await fleet.preflightFleet(repo, project, remaining, connections, "v2");
  await fleet.deployFleet(
    repo,
    project,
    next.map((entry) => entry.plan),
    connections,
    "v2",
    undefined,
    2,
  );
  const final = [];
  for (const row of rows) {
    const result = await query(
      row.database,
      `SELECT amount FROM ${row.schema}.invoices WHERE id = 1`,
    );
    const columns = await db.listTableColumnsDetailed(
      "postgres",
      url,
      row.schema,
      "invoices",
      row.database,
    );
    final.push({
      amount: Number(result.rows[0].amount),
      note: columns.some((column) => column.name === "note"),
    });
  }
  const publicRows = await query(rows[0].database, "SELECT COUNT(*) AS count FROM public.invoices");
  await query(rows[0].database, `CREATE SCHEMA ${uiSchema}`);
  await query(
    rows[0].database,
    `CREATE TABLE ${uiSchema}.invoices (id integer PRIMARY KEY, amount numeric NOT NULL, note text)`,
  );
  await query(rows[0].database, `INSERT INTO ${uiSchema}.invoices VALUES (1, 44, NULL)`);
  return {
    duplicateBlocked,
    before: before.map((entry) => entry.error),
    afterCanary,
    final,
    publicUntouched: Number(publicRows.rows[0].count) === Number(publicBefore.rows[0].count),
    uiSchema,
    releases: (await repository.readTargets(repo, project.id)).store.targets.map(
      (target) => target.release?.id,
    ),
  };
}
