export async function runPostgresScenario(repo: string) {
  const model = await import("/src/lib/versioning/model.ts");
  const api = await import("/src/lib/versioning/repository.ts");
  const db = await import("/src/lib/db/index.ts");
  const capture = await import("/src/lib/versioning/capture.ts");
  const deployment = await import("/src/lib/versioning/deploy.ts");
  const ledger = await import("/src/lib/versioning/ledger.ts");
  const connection = {
    id: "Development",
    name: "Development",
    kind: "postgres",
    connectionString: "postgresql://lab@127.0.0.1:55440/l8db_versioning_dev",
    sslMode: "disable",
  };
  const object = {
    id: "invoices",
    path: "database/objects/invoices.sql",
    selection: { schema: "public", objectType: "table", objectName: "invoices", objectOid: null },
  };
  const loaded = await api.loadRepository(repo);
  const project = { ...loaded.project, objects: [object] };
  await api.saveFile(repo, model.PROJECT_PATH, api.encode(project), loaded.projectText);
  const execute = (database, sql) =>
    db.executeScript("postgres", connection.connectionString, sql, database, { confirmed: true });
  for (const database of [
    "l8db_versioning_dev",
    "l8db_versioning_a",
    "l8db_versioning_b",
    "l8db_versioning_edge",
  ]) {
    const results = await execute(
      database,
      'DROP TABLE IF EXISTS public."L8DB_VERSIONING_LOCKS", public."L8DB_VERSIONING_POLICY", public."L8DB_VERSIONING_JOURNAL", public."L8DB_VERSIONING_APPROVALS"; DROP TABLE IF EXISTS public."L8DB_VERSIONING_STATE"; DROP TABLE IF EXISTS public.invoices; CREATE TABLE public.invoices(id integer PRIMARY KEY, amount numeric NOT NULL);',
    );
    if (results.some((r) => !r.success)) throw new Error("Fixture setup failed");
  }
  const source = await capture.captureObject(connection, "l8db_versioning_dev", object);
  await api.saveFile(repo, object.path, `${source.definition}\n`, null);
  const makeRelease = async (id, parent, sql) => {
    const snapshot = await capture.captureObject(connection, "l8db_versioning_dev", object);
    const release = {
      format: 1,
      id,
      projectId: project.id,
      kind: "postgres",
      parent,
      createdAt: new Date().toISOString(),
      objects: [snapshot],
      migrations: sql
        ? [{ id: `${id}-1`, title: id, sql, checksum: await model.checksum(sql) }]
        : [],
    };
    const path = model.releasePath(id);
    await api.saveFile(repo, path, api.encode(release), null);
    const status = await db.versioningRepository({ action: "status", repo });
    await db.versioningRepository({ action: "commit", repo, paths: status.files, name: id });
    return release;
  };
  await makeRelease("v1", null, "");
  await db.versioningRepository({ action: "branch", repo, name: "feature/approval" });
  const targets = ["a", "b", "edge"].map((name) => ({
    id: name,
    name: `Kunde ${name.toUpperCase()}`,
    connectionId: connection.id,
    database: `l8db_versioning_${name}`,
    production: false,
    release: null,
    history: [],
  }));
  await api.saveTargets(repo, { format: 1, projectId: project.id, targets }, null);
  for (const target of targets)
    await deployment.baselineTarget(repo, project, target.id, connection, "v1");
  const baseline = await api.resolveRelease(
    repo,
    project,
    (await api.readTargets(repo, project.id)).store.targets[2].release,
  );
  const locks = await Promise.allSettled([
    ledger.acquireLease(connection, project, targets[2], baseline, "lease-one"),
    ledger.acquireLease(connection, project, targets[2], baseline, "lease-two"),
  ]);
  const lockWinner = locks.findIndex((entry) => entry.status === "fulfilled");
  const concurrentBlocked = locks.filter((entry) => entry.status === "fulfilled").length === 1;
  await ledger.finishLease(
    connection,
    project,
    targets[2],
    lockWinner === 0 ? "lease-one" : "lease-two",
    true,
  );
  const sql2 = "ALTER TABLE public.invoices ADD COLUMN note text;";
  await execute("l8db_versioning_dev", sql2);
  await makeRelease("v2", "v1", sql2);
  let current = (await api.readTargets(repo, project.id)).store;
  let plan = await deployment.planDeployment(repo, project, current.targets[1], connection, "v2");
  await api.saveFile(repo, "database/review.md", "Reviewed state changed", null);
  await db.versioningRepository({
    action: "commit",
    repo,
    paths: ["database/review.md"],
    name: "Concurrent Git change",
  });
  let stalePlanBlocked = false;
  try {
    await deployment.deploy(repo, project, "b", connection, "v2", plan.reviewToken);
  } catch {
    stalePlanBlocked = true;
  }
  plan = await deployment.planDeployment(repo, project, current.targets[1], connection, "v2");
  await deployment.deploy(repo, project, "b", connection, "v2", plan.reviewToken);
  const sql3 = "ALTER TABLE public.invoices ADD COLUMN approved boolean DEFAULT false;";
  await execute("l8db_versioning_dev", sql3);
  await makeRelease("v3", "v2", sql3);
  current = (await api.readTargets(repo, project.id)).store;
  const plans = await Promise.all(
    current.targets
      .slice(0, 2)
      .map((target) => deployment.planDeployment(repo, project, target, connection, "v3")),
  );
  const lengths = plans.map((p) => p.releases.length);
  for (const p of plans)
    await deployment.deploy(repo, project, p.target.id, connection, "v3", p.reviewToken);
  current = (await api.readTargets(repo, project.id)).store;
  await execute("l8db_versioning_a", "ALTER TABLE public.invoices ADD COLUMN customer_only text");
  const drift = await deployment.inspectTarget(repo, project, current.targets[0], connection);
  let driftBlocked = false;
  try {
    await deployment.deploy(repo, project, "a", connection, "v3", plans[0].reviewToken);
  } catch {
    driftBlocked = true;
  }
  const sqlBad =
    "ALTER TABLE public.invoices ADD COLUMN transient_column int; INSERT INTO public.missing_table VALUES (1);";
  await makeRelease("v4-broken", "v3", sqlBad);
  current = (await api.readTargets(repo, project.id)).store;
  plan = await deployment.planDeployment(
    repo,
    project,
    current.targets[1],
    connection,
    "v4-broken",
  );
  let failed = false;
  try {
    await deployment.deploy(repo, project, "b", connection, "v4-broken", plan.reviewToken);
  } catch {
    failed = true;
  }
  current = (await api.readTargets(repo, project.id)).store;
  const columns = await db.listTableColumnsDetailed(
    "postgres",
    connection.connectionString,
    "public",
    "invoices",
    "l8db_versioning_b",
  );
  let retryBlocked = false;
  try {
    await deployment.planDeployment(repo, project, current.targets[1], connection, "v4-broken");
  } catch {
    retryBlocked = true;
  }
  let readonlyBlocked = false;
  try {
    await deployment.planDeployment(
      repo,
      project,
      current.targets[2],
      { ...connection, readOnly: true },
      "v3",
    );
  } catch {
    readonlyBlocked = true;
  }
  return {
    stalePlanBlocked,
    concurrentBlocked,
    lengths,
    versions: current.targets.map((target) => target.release?.id),
    drift: drift.differences.some((item) => item.status === "changed"),
    driftBlocked,
    failed,
    rollback: !columns.some((column) => column.name === "transient_column"),
    retryBlocked,
    readonlyBlocked,
    failureRecorded: current.targets[1].history[0].status === "failed",
  };
}
