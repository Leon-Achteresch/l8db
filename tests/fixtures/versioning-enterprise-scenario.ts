export async function startEnterpriseScenario(repo: string, kind: "postgres" | "oracle") {
  const db = await import("/src/lib/db/index.ts");
  const api = await import("/src/lib/versioning/repository.ts");
  const model = await import("/src/lib/versioning/model.ts");
  const deployment = await import("/src/lib/versioning/deploy.ts");
  const shared = await import("/src/lib/versioning/control.ts");
  const { useConnectionsStore } = await import("/src/lib/connections/index.ts");
  const connection = useConnectionsStore.getState().connections.find((item) => item.kind === kind);
  const { project } = await api.loadRepository(repo);
  const targets = async () => (await api.readTargets(repo, project.id)).store.targets;
  let target = (await targets())[1];
  const base = await api.resolveRelease(repo, project, target.release);
  const table = kind === "postgres" ? "public.invoices" : `"${target.schema}".INVOICES`;
  const query = (sql: string) =>
    db.executeQuery(kind, connection.connectionString, sql, target.database ?? undefined, {
      confirmed: true,
    });
  const blocked = async (action: () => Promise<unknown>) => {
    try {
      await action();
      return false;
    } catch {
      return true;
    }
  };
  const make = async (id: string, sql: string) => {
    const release = {
      ...base,
      id,
      parent: base.id,
      createdAt: new Date().toISOString(),
      migrations: [{ id: `${id}-migration`, title: id, sql, checksum: await model.checksum(sql) }],
    };
    const path = `database/releases/${id}.json`;
    await api.saveFile(repo, path, api.encode(release), null);
    await db.versioningRepository({ action: "commit", repo, paths: [path], name: id });
    return release;
  };
  const baseline = async (targetId: string) => {
    const before = JSON.stringify(await targets());
    try {
      await deployment.baselineTarget(repo, project, targetId, connection, base.id, true);
    } catch (error) {
      if (kind !== "oracle" || !String(error).includes("ORA-01466")) throw error;
      if (JSON.stringify(await targets()) !== before)
        throw new Error("Failed Oracle snapshot changed target state");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await deployment.baselineTarget(repo, project, targetId, connection, base.id, true);
    }
  };
  let creationSchemaCorrect = true;
  if (kind === "postgres") {
    const { openVersioningSession } = await import("/src/lib/versioning/session.ts");
    const transaction = await openVersioningSession(connection, target, base);
    try {
      await db.executeInTransaction(transaction, "CREATE TABLE l8db_schema_probe (id integer)", {
        confirmed: true,
      });
      const columns = await db.versioningMetadata(
        transaction,
        "columns",
        target.schema || "public",
        "l8db_schema_probe",
      );
      creationSchemaCorrect = columns.length === 1;
    } finally {
      await db.rollbackTransaction(transaction);
    }
  }
  const lockTx = await db.beginTransaction(
    kind,
    connection.connectionString,
    target.database ?? undefined,
  );
  let executionLockBlocksRecovery = false;
  try {
    await shared.control(connection, project, target, "execution-lock", { txId: lockTx });
    if (kind === "oracle")
      await db.executeInTransaction(
        lockTx,
        `CREATE OR REPLACE VIEW "${target.schema}".VCS_LOCK_PROBE AS SELECT 1 AS id FROM dual`,
        { confirmed: true },
      );
    executionLockBlocksRecovery = await blocked(() =>
      deployment.baselineTarget(repo, project, target.id, connection, base.id, true),
    );
  } finally {
    await db.rollbackTransaction(lockTx);
  }
  await make(
    "enterprise-wrong-schema",
    `ALTER TABLE invoices ADD ${kind === "postgres" ? "unexpected integer" : "unexpected NUMBER"}; UPDATE invoices SET amount=amount+1;`,
  );
  let plan = await deployment.planDeployment(
    repo,
    project,
    target,
    connection,
    "enterprise-wrong-schema",
  );
  const structureMismatchBlocked = await blocked(() =>
    deployment.deploy(
      repo,
      project,
      target.id,
      connection,
      "enterprise-wrong-schema",
      plan.reviewToken,
    ),
  );
  const columns = await db.listTableColumnsDetailed(
    kind,
    connection.connectionString,
    target.schema || "public",
    kind === "postgres" ? "invoices" : "INVOICES",
    target.database ?? undefined,
  );
  const columnExists = columns.some((item) => item.name.toLowerCase() === "unexpected");
  const structureOutcomeCorrect = columnExists === (kind === "oracle");
  if (columnExists) await query(`ALTER TABLE ${table} DROP COLUMN unexpected`);
  await baseline(target.id);
  target = (await targets())[1];
  const expected =
    Number(Object.values((await query(`SELECT amount FROM ${table} WHERE id=1`)).rows[0])[0]) + 1;
  await make(
    "enterprise-background",
    kind === "postgres"
      ? "UPDATE invoices SET amount=amount+1; SELECT pg_sleep(3);"
      : "UPDATE invoices SET amount=amount+1;\nBEGIN DBMS_SESSION.SLEEP(3); END;\n/",
  );
  plan = await deployment.planDeployment(
    repo,
    project,
    target,
    connection,
    "enterprise-background",
  );
  let other = (await targets())[0];
  if (kind === "oracle") {
    const otherColumns = await db.listTableColumnsDetailed(
      kind,
      connection.connectionString,
      other.schema,
      "INVOICES",
    );
    if (otherColumns.some((column) => column.name === "DDL_PROBE"))
      await db.executeQuery(
        kind,
        connection.connectionString,
        `ALTER TABLE "${other.schema}".INVOICES DROP COLUMN DDL_PROBE`,
        undefined,
        { confirmed: true },
      );
  }
  await baseline(other.id);
  other = (await targets())[0];
  const otherPlan = await deployment.planDeployment(
    repo,
    project,
    other,
    connection,
    "enterprise-background",
  );
  const otherTable = kind === "postgres" ? "public.invoices" : `"${other.schema}".INVOICES`;
  const otherValue = await db.executeQuery(
    kind,
    connection.connectionString,
    `SELECT amount FROM ${otherTable} WHERE id=1`,
    other.database ?? undefined,
  );
  const otherExpected = Number(Object.values(otherValue.rows[0])[0]) + 1;
  const requests = [plan, otherPlan].map((item) => ({
    repo,
    targetId: item.target.id,
    runId: crypto.randomUUID(),
    artifact: item.reviewArtifact,
    connection: {
      kind,
      connectionString: connection.connectionString,
      database: item.target.database,
      schema: item.target.ledgerSchema,
      projectId: project.id,
      readOnly: false,
    },
  }));
  const id = await db.versioningRunFleet(requests);
  const duplicateRunBlocked =
    (await blocked(() => db.versioningRun(requests[0]))) &&
    (await blocked(() => db.versioningRunFleet(requests)));
  return {
    id,
    projectId: project.id,
    targetId: target.id,
    expected,
    wave: requests.map((request, index) => ({
      targetId: request.targetId,
      runId: request.runId,
      expected: index === 0 ? expected : otherExpected,
    })),
    creationSchemaCorrect,
    executionLockBlocksRecovery,
    structureMismatchBlocked,
    structureOutcomeCorrect,
    duplicateRunBlocked,
  };
}

export async function finishEnterpriseScenario(
  repo: string,
  kind: "postgres" | "oracle",
  started: {
    id: string;
    projectId: string;
    targetId: string;
    expected: number;
    wave: { targetId: string; runId: string; expected: number }[];
  },
) {
  const db = await import("/src/lib/db/index.ts");
  const api = await import("/src/lib/versioning/repository.ts");
  const shared = await import("/src/lib/versioning/control.ts");
  const { useConnectionsStore } = await import("/src/lib/connections/index.ts");
  const connection = useConnectionsStore.getState().connections.find((item) => item.kind === kind);
  for (let retry = 0; retry < 80; retry++) {
    const status = await db.versioningRunStatus(started.id);
    if (status.status === "failed") throw new Error(status.error);
    if (status.status === "succeeded") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const { store } = await api.readTargets(repo, started.projectId);
  const { project } = await api.loadRepository(repo);
  const results = [];
  for (const member of started.wave) {
    const target = store.targets.find((entry) => entry.id === member.targetId);
    const table = kind === "postgres" ? "public.invoices" : `"${target.schema}".INVOICES`;
    const result = await db.executeQuery(
      kind,
      connection.connectionString,
      `SELECT amount FROM ${table} WHERE id=1`,
      target.database ?? undefined,
    );
    const journal = await shared.control(connection, project, target, "journal");
    const events = journal
      .filter((entry) => entry.RUN_ID === member.runId)
      .map((entry) => entry.EVENT);
    results.push({
      backgroundSurvivedReload:
        target.release.id === "enterprise-background" &&
        target.history[0].status === "succeeded" &&
        Number(Object.values(result.rows[0])[0]) === member.expected,
      durableJournal: [
        "started",
        "statement_started",
        "statement_confirmed",
        "commit_requested",
        "commit_confirmed",
        "succeeded",
      ].every((entry) => events.includes(entry)),
    });
  }
  return {
    backgroundSurvivedReload: results.every((entry) => entry.backgroundSurvivedReload),
    durableJournal: results.every((entry) => entry.durableJournal),
  };
}
