export async function runOperationalScenario(repo, kind) {
  const model = await import("/src/lib/versioning/model.ts");
  const api = await import("/src/lib/versioning/repository.ts");
  const db = await import("/src/lib/db/index.ts");
  const capture = await import("/src/lib/versioning/capture.ts");
  const deployment = await import("/src/lib/versioning/deploy.ts");
  const fleet = await import("/src/lib/versioning/fleet.ts");
  const safety = await import("/src/lib/versioning/safety.ts");
  const pg = kind === "postgres";
  const connection = {
    id: pg ? "Development" : "Oracle Lab",
    name: "Operations Lab",
    kind,
    connectionString: pg
      ? "postgresql://lab@127.0.0.1:55440/l8db_versioning_dev"
      : "oracle://lab@127.0.0.1:55441/FREEPDB1",
    sslMode: "disable",
  };
  const object = {
    id: "invoices",
    metadataVersion: 2,
    path: "database/objects/invoices.sql",
    selection: {
      schema: pg ? "public" : "L8DB_VCS_DEV",
      objectType: "table",
      objectName: pg ? "invoices" : "INVOICES",
      objectOid: null,
    },
  };
  const project = {
    format: 1,
    id: `operations-${kind}`,
    name: "Operations Product",
    kind,
    objects: [object],
  };
  const locations = pg
    ? ["l8db_versioning_dev", "l8db_versioning_a", "l8db_versioning_b"]
    : ["L8DB_VCS_DEV", "L8DB_VCS_A", "L8DB_VCS_B"];
  const query = (location, sql) =>
    db.executeQuery(kind, connection.connectionString, sql, pg ? location : undefined, {
      confirmed: true,
    });
  const table = (location) => (pg ? "public.invoices" : `"${location}".INVOICES`);
  for (const location of locations) {
    for (const name of [
      pg ? 'public."L8DB_VERSIONING_STATE"' : `"${location}"."L8DB_VERSIONING_STATE"`,
      ...["LOCKS", "POLICY", "JOURNAL", "APPROVALS"].map(
        (suffix) => `${pg ? "public" : `"${location}"`}."L8DB_VERSIONING_${suffix}"`,
      ),
      table(location),
    ]) {
      try {
        await query(location, `DROP TABLE ${name}`);
      } catch {}
    }
    await query(
      location,
      `CREATE TABLE ${table(location)} (id ${pg ? "integer" : "NUMBER"} PRIMARY KEY, amount ${pg ? "integer" : "NUMBER"} NOT NULL)`,
    );
    await query(location, `INSERT INTO ${table(location)} VALUES (1, 1)`);
  }
  await api.saveFile(repo, model.PROJECT_PATH, api.encode(project), null);
  const snapshot = await capture.captureObject(connection, pg ? locations[0] : null, object);
  await api.saveFile(repo, object.path, snapshot.definition, null);
  const checkSql = "SELECT COUNT(*) AS invalid FROM invoices WHERE amount < 0";
  const checks = [
    {
      id: "nonnegative",
      title: "Beträge nicht negativ",
      sql: checkSql,
      expected: "0",
      checksum: await model.checksum(checkSql),
    },
  ];
  const planSafety = {
    ...safety.defaultSafety(),
    phase: "backfill",
    notes:
      "App v1 und v2 bleiben kompatibel. Kleiner isolierter Backfill; Wiederherstellung aus geprüftem Backup.",
    preconditions: checks,
    postconditions: [{ ...checks[0], id: "nonnegative-after" }],
  };
  const make = async (id, parent, sql, options = {}) => {
    const release = {
      format: 1,
      id,
      parent,
      projectId: project.id,
      kind,
      track: "main",
      createdAt: new Date().toISOString(),
      objects: [snapshot],
      migrations: sql
        ? [{ id: `${id}-migration`, title: id, sql, checksum: await model.checksum(sql) }]
        : [],
      safety: planSafety,
      ...options,
    };
    await api.saveFile(repo, model.releasePath(id), api.encode(release), null);
    const status = await db.versioningRepository({ action: "status", repo });
    await db.versioningRepository({ action: "commit", repo, paths: status.files, name: id });
    return release;
  };
  await make("v1", null, "");
  const targets = locations.slice(1).map((location, index) => ({
    id: String(index),
    name: `Customer ${index + 1}`,
    connectionId: connection.id,
    database: pg ? location : null,
    schema: pg ? null : location,
    production: true,
    release: null,
    history: [],
  }));
  await api.saveTargets(repo, { format: 1, projectId: project.id, targets }, null);
  for (const target of targets) {
    try {
      await deployment.baselineTarget(repo, project, target.id, connection, "v1");
    } catch (error) {
      if (pg || !String(error).includes("ORA-01466")) throw error;
      const interrupted = (await api.readTargets(repo, project.id)).store.targets.find(
        (entry) => entry.id === target.id,
      );
      if (interrupted.release !== null || interrupted.history.length !== 0)
        throw new Error("Oracle snapshot failure changed the baseline.");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await deployment.baselineTarget(repo, project, target.id, connection, "v1");
    }
  }
  await make("v2", "v1", "UPDATE invoices SET amount = amount + 10;");
  const current = async () => (await api.readTargets(repo, project.id)).store.targets;
  const value = async (location) =>
    Object.values(
      (await query(location, `SELECT amount FROM ${table(location)} WHERE id=1`)).rows[0],
    )[0];
  const blocked = async (action) => {
    try {
      await action();
      return false;
    } catch {
      return true;
    }
  };
  let stored = await current();
  const plans = await Promise.all(
    stored.map((target) => deployment.planDeployment(repo, project, target, connection, "v2")),
  );
  const expiryBlocked = await blocked(() =>
    deployment.assertReviewedToken(
      `${Date.now() - 16 * 60 * 1000}:${plans[0].reviewToken.split(":")[1]}`,
      plans[0].reviewToken,
    ),
  );
  const shared = await import("/src/lib/versioning/control.ts");
  const basePolicy = await shared.control(connection, project, stored[0], "policy");
  const changePolicy = async (change) => {
    const current = await shared.control(connection, project, stored[0], "policy");
    await shared.control(connection, project, stored[0], "save-policy", {
      revision: current.revision,
      policy: { ...basePolicy.policy, ...change },
    });
  };
  await changePolicy({ paused: true });
  const pauseBlocked = await blocked(() =>
    deployment.planDeployment(repo, project, { ...stored[0], paused: false }, connection, "v2"),
  );
  await changePolicy({ pinnedRelease: "v1" });
  const pinBlocked = await blocked(() =>
    deployment.planDeployment(repo, project, stored[0], connection, "v2"),
  );
  await changePolicy({ track: "customer-variant" });
  const variantBlocked = await blocked(() =>
    deployment.planDeployment(repo, project, stored[0], connection, "v2"),
  );
  await changePolicy({});
  const endpointBlocked = await blocked(() =>
    deployment.planDeployment(
      repo,
      project,
      stored[0],
      {
        ...connection,
        connectionString: connection.connectionString.replace("127.0.0.1", "localhost"),
      },
      "v2",
    ),
  );
  const alias = { ...connection, id: "alias" };
  const duplicate = await fleet.preflightFleet(
    repo,
    project,
    [stored[0], { ...stored[0], id: "alias", connectionId: "alias" }],
    [connection, alias],
    "v2",
  );
  const duplicateBlocked = duplicate[1].error?.includes("mehrfach") === true;
  await query(locations[2], `UPDATE ${table(locations[2])} SET amount = -1`);
  const fleetBlocked = await blocked(() =>
    fleet.deployFleet(repo, project, plans, [connection], "v2"),
  );
  const noPartialStart =
    Number(await value(locations[1])) === 1 &&
    (await current()).every((target) => target.history.length === 0);
  await query(locations[2], `UPDATE ${table(locations[2])} SET amount = 1`);
  const fresh = await fleet.preflightFleet(repo, project, await current(), [connection], "v2");
  await api.saveFile(repo, "database/releases/untracked-draft.json", "unfinished draft", null);
  await fleet.deployFleet(
    repo,
    project,
    fresh.map((entry) => entry.plan),
    [connection],
    "v2",
  );
  await db.versioningRepository({
    action: "delete",
    repo,
    path: "database/releases/untracked-draft.json",
    expected: "unfinished draft",
  });
  const historicalIsolation = (await current()).every((target) => target.release.id === "v2");
  const schemaContextCorrect =
    Number(await value(locations[0])) === 1 &&
    Number(await value(locations[1])) === 11 &&
    Number(await value(locations[2])) === 11;
  await make("v3-bad-data", "v2", "UPDATE invoices SET amount = -99;");
  stored = await current();
  let plan = await deployment.planDeployment(repo, project, stored[0], connection, "v3-bad-data");
  const postconditionBlocked = await blocked(() =>
    deployment.deploy(repo, project, stored[0].id, connection, "v3-bad-data", plan.reviewToken),
  );
  const dataRolledBack =
    Number(await value(locations[1])) === 11 && (await current())[0].release.id === "v2";
  await deployment.baselineTarget(repo, project, stored[0].id, connection, "v2", true);
  let boundedExecution = false;
  let partialDdlRecorded = false;
  if (pg) {
    await make("v4-timeout", "v2", "UPDATE invoices SET amount = amount + 1; SELECT pg_sleep(1);", {
      safety: { ...planSafety, lockTimeoutMs: 100, statementTimeoutMs: 300 },
    });
    stored = await current();
    plan = await deployment.planDeployment(repo, project, stored[0], connection, "v4-timeout");
    boundedExecution =
      (await blocked(() =>
        deployment.deploy(repo, project, stored[0].id, connection, "v4-timeout", plan.reviewToken),
      )) && Number(await value(locations[1])) === 11;
    await deployment.baselineTarget(repo, project, stored[0].id, connection, "v2", true);
    await make("v5-lock", "v2", "ALTER TABLE invoices ADD COLUMN lock_probe integer;", {
      safety: { ...planSafety, phase: "expand", lockTimeoutMs: 100, statementTimeoutMs: 1000 },
    });
    stored = await current();
    plan = await deployment.planDeployment(repo, project, stored[0], connection, "v5-lock");
    const transaction = await db.beginTransaction(kind, connection.connectionString, locations[1]);
    try {
      await db.executeInTransaction(
        transaction,
        "LOCK TABLE public.invoices IN ROW EXCLUSIVE MODE",
        { confirmed: true },
      );
      boundedExecution =
        boundedExecution &&
        (await blocked(() =>
          deployment.deploy(repo, project, stored[0].id, connection, "v5-lock", plan.reviewToken),
        ));
    } finally {
      await db.rollbackTransaction(transaction);
    }
    partialDdlRecorded = !(
      await db.listTableColumnsDetailed(
        kind,
        connection.connectionString,
        "public",
        "invoices",
        locations[1],
      )
    ).some((column) => column.name === "lock_probe");
  } else {
    await make(
      "v4-partial",
      "v2",
      "ALTER TABLE invoices ADD ddl_probe NUMBER; UPDATE invoices SET amount = -99;",
    );
    stored = await current();
    plan = await deployment.planDeployment(repo, project, stored[0], connection, "v4-partial");
    boundedExecution = await blocked(() =>
      deployment.deploy(repo, project, stored[0].id, connection, "v4-partial", plan.reviewToken),
    );
    const columns = await db.listTableColumnsDetailed(
      kind,
      connection.connectionString,
      locations[1],
      "INVOICES",
    );
    partialDdlRecorded =
      columns.some((column) => column.name === "DDL_PROBE") &&
      (await current())[0].history[0].completedStatements.length === 2 &&
      Number(await value(locations[1])) === 11;
  }
  let oracleConstraintDrift = null;
  if (!pg) {
    const owner = locations[0];
    for (const name of ["VCS_CHILD", "VCS_PARENT", "VCS_OTHER"]) {
      try {
        await query(owner, `DROP TABLE "${owner}".${name}`);
      } catch {}
    }
    for (const name of ["VCS_PARENT", "VCS_OTHER"])
      await query(owner, `CREATE TABLE "${owner}".${name} (id NUMBER PRIMARY KEY)`);
    await query(
      owner,
      `CREATE TABLE "${owner}".VCS_CHILD (parent_id NUMBER, CONSTRAINT vcs_fk FOREIGN KEY (parent_id) REFERENCES "${owner}".VCS_PARENT(id))`,
    );
    const child = {
      ...object,
      id: "child",
      selection: { ...object.selection, objectName: "VCS_CHILD" },
    };
    const before = await capture.captureObject(connection, null, child);
    await query(owner, `ALTER TABLE "${owner}".VCS_CHILD DROP CONSTRAINT vcs_fk`);
    await query(
      owner,
      `ALTER TABLE "${owner}".VCS_CHILD ADD CONSTRAINT vcs_fk FOREIGN KEY (parent_id) REFERENCES "${owner}".VCS_OTHER(id)`,
    );
    const after = await capture.captureObject(connection, null, child);
    await query(owner, `ALTER TABLE "${owner}".VCS_CHILD DISABLE CONSTRAINT vcs_fk`);
    const disabled = await capture.captureObject(connection, null, child);
    oracleConstraintDrift =
      before.checksum !== after.checksum &&
      after.checksum !== disabled.checksum &&
      after.definition.includes("VCS_OTHER");
    for (const name of ["VCS_CHILD", "VCS_PARENT", "VCS_OTHER"])
      await query(owner, `DROP TABLE "${owner}".${name}`);
  }
  return {
    expiryBlocked,
    pauseBlocked,
    pinBlocked,
    variantBlocked,
    endpointBlocked,
    duplicateBlocked,
    fleetBlocked,
    noPartialStart,
    historicalIsolation,
    schemaContextCorrect,
    postconditionBlocked,
    dataRolledBack,
    boundedExecution,
    partialDdlRecorded,
    oracleConstraintDrift,
  };
}
