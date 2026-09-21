export async function runOracleScenario(repo: string) {
  const model = await import("/src/lib/versioning/model.ts");
  const api = await import("/src/lib/versioning/repository.ts");
  const db = await import("/src/lib/db/index.ts");
  const capture = await import("/src/lib/versioning/capture.ts");
  const deployment = await import("/src/lib/versioning/deploy.ts");
  const sources = await import("/src/lib/versioning/sources.ts");
  const connection = {
    id: "Oracle Lab",
    name: "Oracle Lab",
    kind: "oracle",
    connectionString: "oracle://lab@127.0.0.1:55441/FREEPDB1",
    sslMode: "disable",
  };
  const object = {
    id: "order-service",
    path: "database/objects/order-service.sql",
    selection: {
      schema: "L8DB_VCS_DEV",
      objectType: "package",
      objectName: "ORDER_SERVICE",
      objectOid: null,
    },
  };
  const project = {
    format: 1,
    id: "oracle-product",
    name: "Oracle Product",
    kind: "oracle",
    objects: [object],
  };
  const body = (schema, factor) =>
    `CREATE OR REPLACE PACKAGE BODY "${schema}"."ORDER_SERVICE" AS FUNCTION calculate_total(value NUMBER) RETURN NUMBER IS BEGIN RETURN value * ${factor}; END; END ORDER_SERVICE;`;
  const exec = async (sql) => {
    const results = await db.executeScript("oracle", connection.connectionString, sql, undefined, {
      confirmed: true,
    });
    if (results.some((r) => !r.success)) throw new Error(results.find((r) => !r.success).error);
  };
  for (const schema of ["L8DB_VCS_DEV", "L8DB_VCS_A", "L8DB_VCS_B"]) {
    await db.executeScript(
      "oracle",
      connection.connectionString,
      `DROP TABLE "${schema}"."L8DB_VERSIONING_STATE"`,
      undefined,
      { confirmed: true },
    );
    await db.executeScript(
      "oracle",
      connection.connectionString,
      `DROP PROCEDURE "${schema}"."BROKEN_PROC"`,
      undefined,
      { confirmed: true },
    );
    await exec(body(schema, 1));
  }
  const splitObject = sources.newManagedObject({
    ...object.selection,
    connectionId: connection.id,
    database: null,
  });
  const splitSnapshot = await capture.captureObject(connection, null, splitObject);
  for (const [path, value] of Object.entries(sources.sourceFiles(splitSnapshot)))
    await api.saveFile(repo, path, value, null);
  const roundtrip = await sources.workingSnapshot(repo, splitObject);
  const sourceRoundtrip = roundtrip.checksum === splitSnapshot.checksum;
  const pureFiles = Object.values(sources.sourceFiles(splitSnapshot)).every((source) =>
    source.trim().startsWith("CREATE OR REPLACE"),
  );
  await api.saveFile(repo, model.PROJECT_PATH, api.encode(project), null);
  const makeRelease = async (id, parent, sql) => {
    const snapshot = await capture.captureObject(connection, null, object);
    const release = {
      format: 1,
      id,
      projectId: project.id,
      kind: "oracle",
      parent,
      createdAt: new Date().toISOString(),
      objects: [snapshot],
      migrations: sql
        ? [{ id: `${id}-1`, title: id, sql, checksum: await model.checksum(sql) }]
        : [],
    };
    await api.saveFile(repo, model.releasePath(id), api.encode(release), null);
    const previous = await api.readFile(repo, object.path);
    await api.saveFile(repo, object.path, snapshot.definition, previous);
    const status = await db.versioningRepository({ action: "status", repo });
    await db.versioningRepository({ action: "commit", repo, paths: status.files, name: id });
    return (await db.versioningRepository({ action: "status", repo })).head;
  };
  const baseCommit = await makeRelease("v1", null, "");
  const targets = ["A", "B"].map((id) => ({
    id,
    name: `Oracle Kunde ${id}`,
    connectionId: connection.id,
    database: null,
    schema: `L8DB_VCS_${id}`,
    production: false,
    release: null,
    history: [],
  }));
  await api.saveTargets(repo, { format: 1, projectId: project.id, targets }, null);
  for (const target of targets)
    await deployment.baselineTarget(repo, project, target.id, connection, "v1");
  await exec(body("L8DB_VCS_DEV", 2));
  const nextCommit = await makeRelease("v2", "v1", body("L8DB_VCS_DEV", 2));
  let store = (await api.readTargets(repo, project.id)).store;
  const plan = await deployment.planDeployment(repo, project, store.targets[0], connection, "v2");
  await deployment.deploy(repo, project, "A", connection, "v2", plan.reviewToken);
  await exec(body("L8DB_VCS_B", 3));
  store = (await api.readTargets(repo, project.id)).store;
  const customer = await deployment.inspectTarget(repo, project, store.targets[1], connection);
  const base = await api.readFile(repo, object.path, baseCommit);
  const incoming = await api.readFile(repo, object.path, nextCommit);
  const merge = await db.versioningRepository({
    action: "merge",
    repo,
    content: customer.actual[0].definition,
    base,
    incoming,
  });
  const large = Array.from({ length: 8000 }, (_, i) => `line_${i}`).join("\n");
  const cleanMerge = await db.versioningRepository({
    action: "merge",
    repo,
    content: large.replace("line_50\n", "customer change\n"),
    base: large,
    incoming: large.replace("line_7900\n", "product change\n"),
  });
  const bad = `${body("L8DB_VCS_DEV", 4)}\n/\nCREATE OR REPLACE PROCEDURE "L8DB_VCS_DEV"."BROKEN_PROC" AS BEGIN this_does_not_exist; END;\n/\n${body("L8DB_VCS_DEV", 99)}\n/`;
  await makeRelease("v3-broken", "v2", bad);
  store = (await api.readTargets(repo, project.id)).store;
  const brokenPlan = await deployment.planDeployment(
    repo,
    project,
    store.targets[0],
    connection,
    "v3-broken",
  );
  let failed = false;
  try {
    await deployment.deploy(repo, project, "A", connection, "v3-broken", brokenPlan.reviewToken);
  } catch {
    failed = true;
  }
  const actual = await capture.captureObject(connection, null, object, "L8DB_VCS_A");
  store = (await api.readTargets(repo, project.id)).store;
  return {
    sourceRoundtrip,
    pureFiles,
    mappedDeployment: store.targets[0].release.id === "v2",
    customerDrift: customer.differences[0].status === "changed",
    conflict: merge.conflicts,
    cleanMerge:
      !cleanMerge.conflicts &&
      cleanMerge.content.includes("customer change") &&
      cleanMerge.content.includes("product change"),
    failed,
    partial: actual.definition.includes("value * 4"),
    stopped: !actual.definition.includes("value * 99"),
    recorded:
      store.targets[0].history[0].status === "failed" &&
      store.targets[0].history[0].completedStatements.length === 1 &&
      store.targets[0].history[0].inFlightStatement.endsWith(":2"),
  };
}
