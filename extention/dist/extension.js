var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// extention/src/extension.ts
var exports_extension = {};
__export(exports_extension, {
  validatePlanSummary: () => validatePlanSummary,
  jevRequest: () => jevRequest,
  activate: () => activate
});
module.exports = __toCommonJS(exports_extension);
var ENDPOINT = "https://api.typesafe.ai/v1/systemone";
var KEY_NAME = "apiKey";
var AUTO_KEY = "autoAnalyze";
var KINDS = new Set([
  "sequential_scan",
  "index_scan",
  "bitmap_scan",
  "sort",
  "hash",
  "nested_loop",
  "merge_join",
  "hash_join",
  "aggregate",
  "limit",
  "other"
]);
var SIZES = new Set(["none", "1", "2-9", "10-99", "100-999", "1k-9k", "10k+"]);
var TIMES = new Set(["unknown", "<1ms", "1-9ms", "10-99ms", "100-999ms", "1s+"]);
var MISMATCHES = new Set(["unknown", "low", "medium", "high"]);
var LABELS = {
  scan: "Breiter Tabellenscan",
  sort: "Sortierung",
  join: "Join-Verarbeitung",
  estimate: "Abweichende Zeilenschätzung",
  unclear: "Keine klare Ursache aus diesen Merkmalen"
};
var VERDICTS = {
  optimal: "Query ist optimal",
  improvable: "Query ist verbesserungswürdig",
  poor: "Query ist nicht optimal"
};
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validatePlanSummary(value) {
  if (!object(value) || value.version !== 1 || typeof value.analyzed !== "boolean" || typeof value.truncated !== "boolean" || !Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 24)
    throw new Error("Ungültige Planmerkmale.");
  const nodes = value.nodes.map((node) => {
    if (!object(node) || typeof node.kind !== "string" || !KINDS.has(node.kind) || typeof node.depth !== "number" || !Number.isInteger(node.depth) || node.depth < 0 || node.depth > 8 || typeof node.estimatedRows !== "string" || !SIZES.has(node.estimatedRows) || typeof node.actualRows !== "string" || !SIZES.has(node.actualRows) || typeof node.elapsed !== "string" || !TIMES.has(node.elapsed) || typeof node.sharedReads !== "string" || !SIZES.has(node.sharedReads) || typeof node.hasFilter !== "boolean" || typeof node.hasIndex !== "boolean" || typeof node.estimateMismatch !== "string" || !MISMATCHES.has(node.estimateMismatch))
      throw new Error("Ungültige Planmerkmale.");
    return {
      kind: node.kind,
      depth: node.depth,
      estimatedRows: node.estimatedRows,
      actualRows: node.actualRows,
      elapsed: node.elapsed,
      sharedReads: node.sharedReads,
      hasFilter: node.hasFilter,
      hasIndex: node.hasIndex,
      estimateMismatch: node.estimateMismatch
    };
  });
  return { version: 1, analyzed: value.analyzed, truncated: value.truncated, nodes };
}
function jevRequest(summary) {
  return {
    model: "jev-latest",
    state: summary,
    questions: {
      bottleneck: {
        type: "choice",
        instructions: "Which single factor is most likely the main performance bottleneck in this execution plan? Use only the structural node categories and precomputed buckets. If the evidence is weak, choose unclear.",
        criteria: {
          scan: "A broad sequential scan dominates the work or reads.",
          sort: "A sort operation dominates the elapsed work.",
          join: "Join processing dominates the elapsed work.",
          estimate: "A large estimated-versus-actual row mismatch likely caused a poor plan.",
          unclear: "The available plan features do not support a clear diagnosis."
        }
      },
      verdict: {
        type: "choice",
        instructions: "How efficient is this execution plan overall? Use only the structural node categories and precomputed buckets.",
        criteria: {
          optimal: "The plan uses appropriate access paths and does no avoidable work.",
          improvable: "The plan works but shows avoidable work such as a broad scan, a large sort or a notable estimate mismatch.",
          poor: "The plan does clearly excessive work that dominates runtime or reads."
        }
      }
    }
  };
}
async function configureKey(api) {
  const key = await api.window.showInputBox({
    title: "TypeSafe API-Schlüssel",
    prompt: "Der Schlüssel wird im Betriebssystem-Schlüsselbund gespeichert.",
    password: true
  });
  if (key === undefined)
    return;
  if (!key.trim())
    throw new Error("API-Schlüssel darf nicht leer sein.");
  await api.secrets.set(KEY_NAME, key.trim());
  await api.notifications.showInfo("TypeSafe API-Schlüssel gespeichert.");
}
async function ensureKey(api) {
  const key = await api.secrets.get(KEY_NAME);
  if (key)
    return key;
  await configureKey(api);
  return api.secrets.get(KEY_NAME);
}
async function autoAllowed(api) {
  const stored = await api.storage.get(AUTO_KEY);
  if (typeof stored === "boolean")
    return stored;
  const choice = await api.window.showInformationMessage("Jev kann Queries beim Schreiben automatisch prüfen. Dabei gehen ohne weitere Rückfrage anonymisierte Planmerkmale an TypeSafe.ai; SQL-Texte, Namen und Zeilen werden nicht übertragen.", "Automatisch prüfen", "Nicht automatisch");
  if (choice === undefined)
    return false;
  const allowed = choice === "Automatisch prüfen";
  await api.storage.set(AUTO_KEY, allowed);
  return allowed;
}
async function analyze(api, payload) {
  const summary = validatePlanSummary(payload);
  const auto = object(payload) && payload.auto === true;
  if (auto && !await autoAllowed(api))
    return;
  const key = auto ? await api.secrets.get(KEY_NAME) : await ensureKey(api);
  if (!key)
    return;
  const request = jevRequest(summary);
  if (!auto) {
    const approved = await api.window.showInformationMessage(`Diese Anfrage geht direkt an TypeSafe.ai. Es werden keine SQL-Texte, Namen oder Zeilen übertragen.

${JSON.stringify(request, null, 2)}`, "An TypeSafe senden");
    if (approved !== "An TypeSafe senden")
      return;
  }
  const response = await api.network.fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    timeoutMs: 15000
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`TypeSafe-Anfrage fehlgeschlagen (HTTP ${response.status}).`);
  const body = JSON.parse(response.body);
  const answers = object(body) && object(body.answers) ? body.answers : {};
  const bottleneck = choice(answers.bottleneck, LABELS);
  const verdict = choice(answers.verdict, VERDICTS);
  if (!bottleneck || !verdict)
    throw new Error("TypeSafe hat keine gültige Diagnose geliefert.");
  const cause = bottleneck.confidence < 0.55 ? LABELS.unclear : LABELS[bottleneck.choice];
  const message = `Jev: ${VERDICTS[verdict.choice]} (Konfidenz ${Math.round(verdict.confidence * 100)} %). Hauptursache: ${cause}.`;
  return {
    verdict: verdict.choice,
    confidence: verdict.confidence,
    bottleneck: bottleneck.choice,
    message
  };
}
function choice(answer, allowed) {
  if (!object(answer) || answer.type !== "choice" || typeof answer.choice !== "string" || !Object.hasOwn(allowed, answer.choice) || typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
    return null;
  return { choice: answer.choice, confidence: answer.confidence };
}
function activate(context, api) {
  context.subscriptions.push(api.commands.registerCommand("jev.configure", () => configureKey(api)), api.commands.registerCommand("jev.removeKey", async () => {
    await api.secrets.delete(KEY_NAME);
    await api.notifications.showInfo("TypeSafe API-Schlüssel gelöscht.");
  }), api.commands.registerCommand("jev.analyze", (payload) => analyze(api, payload)), api.commands.registerCommand("jev.toggleAuto", async () => {
    const next = await api.storage.get(AUTO_KEY) !== true;
    await api.storage.set(AUTO_KEY, next);
    await api.notifications.showInfo(next ? "Automatische Jev-Prüfung aktiviert." : "Automatische Jev-Prüfung deaktiviert.");
  }));
}
