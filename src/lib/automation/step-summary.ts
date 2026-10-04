import type { ChannelRef, Step } from "@/lib/db/automation";
import { COMPARATOR_LABELS } from "./labels";

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

function channel(ref: ChannelRef): string {
  if (ref.type === "native") return "System";
  if (ref.type === "email") return ref.to.length ? `E-Mail an ${ref.to.join(", ")}` : "E-Mail";
  return "Webhook";
}

export function summarizeStep(
  step: Step,
  connectionName: (ref: string) => string = (ref) => ref,
  taskName: (ref: string) => string = (ref) => ref,
): string {
  const action = step.action;
  const conn = (ref: string) => (ref ? connectionName(ref) : "");
  const parts = (...items: (string | null | undefined)[]) => items.filter(Boolean).join(" · ");
  switch (action.type) {
    case "sql":
      return parts(
        action.connections.filter(Boolean).map(conn).join(", "),
        action.file !== null ? basename(action.file) : firstLine(action.sql),
      );
    case "export":
      return parts(
        conn(action.connection),
        action.output.path
          ? `${action.format.toUpperCase()} → ${basename(action.output.path)}`
          : null,
      );
    case "backup":
      return parts(
        conn(action.connection),
        action.output.path ? `→ ${basename(action.output.path)}` : null,
      );
    case "restore":
      return parts(
        action.path ? basename(action.path) : null,
        action.connection ? `→ ${conn(action.connection)}` : null,
      );
    case "transfer":
    case "table_copy":
      return action.source || action.target
        ? `${conn(action.source) || "?"} → ${conn(action.target) || "?"}`
        : "";
    case "datagen":
      return parts(
        conn(action.connection),
        action.table ? `${action.rows} Zeilen in ${action.table}` : null,
      );
    case "import":
      return parts(
        action.file ? basename(action.file) : null,
        action.table ? `→ ${action.table}` : null,
      );
    case "compare": {
      const side = (value: { connection: string; table: string }) =>
        [conn(value.connection), value.table].filter(Boolean).join(" › ");
      return action.left.table || action.right.table || action.left.connection
        ? `${side(action.left) || "?"} ↔ ${side(action.right) || "?"}`
        : "";
    }
    case "check": {
      const check = action.check;
      const target = "table" in check && check.table ? check.table : "";
      return parts(conn(action.connection), target);
    }
    case "alert":
      return parts(conn(action.connection), firstLine(action.sql));
    case "shell":
      return [action.program, ...action.args].filter(Boolean).join(" ");
    case "http":
      return action.url ? `${action.method.toUpperCase()} ${action.url}` : "";
    case "file_copy":
    case "file_move":
      return action.from ? `${basename(action.from)} → ${action.to}` : "";
    case "file_delete":
    case "mkdir":
    case "file_exists":
      return action.path;
    case "zip": {
      const sources = action.sources.filter((entry) => entry.trim());
      const first = sources[0] ? basename(sources[0]) : null;
      return parts(
        first && (sources.length > 1 ? `${first} +${sources.length - 1}` : first),
        action.output.path ? `→ ${basename(action.output.path)}` : null,
      );
    }
    case "unzip":
      return action.archive ? `${basename(action.archive)} → ${action.target}` : "";
    case "cleanup":
      return action.dir ? `${action.dir}/${action.pattern}` : "";
    case "notify":
      return parts(channel(action.channel), action.title);
    case "wait":
      return action.until ? `bis ${action.until}` : action.seconds ? `${action.seconds} s` : "";
    case "set_variable":
      return action.name ? `${action.name} = ${action.query ? "Abfrage" : action.value}` : "";
    case "condition":
      return action.left
        ? `${action.left} ${COMPARATOR_LABELS[action.op]}${action.op === "empty" || action.op === "not_empty" ? "" : ` ${action.right}`}`
        : "";
    case "loop": {
      const over = action.over;
      if (over.type === "query") return parts("für jede Zeile", conn(over.connection));
      if (over.type === "connections")
        return over.tag ? `für jede Verbindung mit Tag ${over.tag}` : "für jede Verbindung";
      if (over.type === "files")
        return over.dir ? `für jede Datei in ${over.dir}` : "für jede Datei";
      return over.values
        ? `für ${over.values.split(/[\n,]/).filter((v) => v.trim()).length} Werte`
        : "";
    }
    case "run_task":
      return action.task ? taskName(action.task) : "";
    case "log":
    case "fail":
      return firstLine(action.message);
  }
}
