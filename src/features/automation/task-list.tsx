import { CheckIcon, SearchIcon, SearchXIcon, XIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { type TaskStatusFilter, useAutomationStore } from "@/lib/automation/store";
import { useAutomationUiState } from "@/lib/automation/ui-state";
import { useNow } from "@/lib/automation/use-now";
import type { TaskSummary } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { TaskBulkBar } from "./task-bulk-bar";
import { TaskFilterChip as FilterChip } from "./task-filter-chip";
import { TaskListDraftItem } from "./task-list-draft-item";
import { TaskListFolder } from "./task-list-folder";
import { TaskListItem } from "./task-list-item";

const STATUS_OPTIONS: { value: TaskStatusFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "enabled", label: "Aktiv" },
  { value: "disabled", label: "Pausiert" },
  { value: "running", label: "Läuft" },
  { value: "failing", label: "Fehlgeschlagen" },
  { value: "review", label: "Zu prüfen" },
];

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  tasks: TaskSummary[];
  count: number;
}

function folderPath(task: TaskSummary): string {
  return task.task.folder
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function buildTree(tasks: TaskSummary[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: new Map(), tasks: [], count: 0 };
  for (const task of tasks) {
    let node = root;
    node.count += 1;
    const parts = folderPath(task).split("/").filter(Boolean);
    for (const part of parts) {
      const path = node.path ? `${node.path}/${part}` : part;
      let next = node.folders.get(part);
      if (!next) {
        next = { name: part, path, folders: new Map(), tasks: [], count: 0 };
        node.folders.set(part, next);
      }
      next.count += 1;
      node = next;
    }
    node.tasks.push(task);
  }
  return root;
}

function matchesStatus(task: TaskSummary, filter: TaskStatusFilter): boolean {
  switch (filter) {
    case "enabled":
      return task.task.enabled;
    case "disabled":
      return !task.task.enabled;
    case "running":
      return Boolean(task.runningRunId);
    case "failing":
      return task.state.lastStatus === "failed" || task.state.lastStatus === "timeout";
    case "review":
      return task.task.needsReview;
    default:
      return true;
  }
}

function haystack(task: TaskSummary): string {
  const sql = task.task.steps
    .map((step) => ("sql" in step.action ? step.action.sql : ""))
    .join(" ");
  return [task.task.name, task.task.description, task.task.tags.join(" "), sql]
    .join(" ")
    .toLowerCase();
}

function option(selected: boolean, onSelect: () => void, label: ReactNode, key?: string) {
  return (
    <DropdownMenuItem key={key} onSelect={onSelect}>
      <CheckIcon className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{label}</span>
    </DropdownMenuItem>
  );
}

export function TaskList() {
  const tasks = useAutomationStore((state) => state.tasks);
  const selectedId = useAutomationStore((state) => state.selectedId);
  const draft = useAutomationStore((state) => state.draft);
  const search = useAutomationStore((state) => state.search);
  const folderFilter = useAutomationStore((state) => state.folderFilter);
  const tagFilter = useAutomationStore((state) => state.tagFilter);
  const statusFilter = useAutomationStore((state) => state.statusFilter);
  const selection = useAutomationStore((state) => state.selection);
  const select = useAutomationStore((state) => state.select);
  const setSearch = useAutomationStore((state) => state.setSearch);
  const setFolderFilter = useAutomationStore((state) => state.setFolderFilter);
  const setTagFilter = useAutomationStore((state) => state.setTagFilter);
  const setStatusFilter = useAutomationStore((state) => state.setStatusFilter);
  const setSelection = useAutomationStore((state) => state.setSelection);
  const toggleSelected = useAutomationStore((state) => state.toggleSelected);
  const confirmDelete = useAutomationStore((state) => state.confirmDelete);
  const collapsed = useAutomationUiState((state) => state.collapsedFolders);
  const toggleFolder = useAutomationUiState((state) => state.toggleFolder);
  const now = useNow();
  const anchor = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keyHandler = useRef<(event: KeyboardEvent, container: HTMLElement) => void>(() => {});

  const folders = useMemo(() => {
    const all = new Set<string>();
    for (const task of tasks) {
      const parts = folderPath(task).split("/").filter(Boolean);
      for (let index = 1; index <= parts.length; index += 1)
        all.add(parts.slice(0, index).join("/"));
    }
    return [...all].sort((a, b) => a.localeCompare(b, "de"));
  }, [tasks]);
  const tags = useMemo(
    () =>
      [...new Set(tasks.flatMap((task) => task.task.tags))].sort((a, b) =>
        a.localeCompare(b, "de"),
      ),
    [tasks],
  );

  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      tasks.filter((task) => {
        if (!matchesStatus(task, statusFilter)) return false;
        if (tagFilter && !task.task.tags.includes(tagFilter)) return false;
        if (folderFilter) {
          const path = folderPath(task);
          if (path !== folderFilter && !path.startsWith(`${folderFilter}/`)) return false;
        }
        return !term || haystack(task).includes(term);
      }),
    [tasks, statusFilter, tagFilter, folderFilter, term],
  );
  const tree = useMemo(() => buildTree(visible), [visible]);
  const chipFiltering = Boolean(folderFilter || tagFilter || statusFilter !== "all");
  const filtering = Boolean(term) || chipFiltering;
  const isOpen = (path: string) => filtering || !collapsed.includes(path);

  const order = useMemo(() => {
    const ids: string[] = [];
    const walk = (node: FolderNode) => {
      for (const child of node.folders.values())
        if (filtering || !collapsed.includes(child.path)) walk(child);
      for (const task of node.tasks) ids.push(task.task.id);
    };
    walk(tree);
    return ids;
  }, [tree, collapsed, filtering]);

  const open = (id: string, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      toggleSelected(id);
      anchor.current = id;
      return;
    }
    if (event.shiftKey && anchor.current) {
      const from = order.indexOf(anchor.current);
      const to = order.indexOf(id);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelection(order.slice(start, end + 1));
        return;
      }
    }
    anchor.current = id;
    if (selection.length) setSelection([]);
    select(id);
  };

  const onKeyDown = (event: KeyboardEvent, container: HTMLElement) => {
    const target = event.target as HTMLElement;
    const id = target.closest<HTMLElement>("[data-task-row]")?.dataset.taskRow;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const buttons = [
        ...container.querySelectorAll<HTMLElement>("[data-task-open], [aria-expanded]"),
      ].filter((element) => element.tagName === "BUTTON" && !element.closest("[role=menu]"));
      const index = buttons.indexOf(target);
      const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && id) {
      if (target.tagName === "INPUT") return;
      event.preventDefault();
      confirmDelete(selection.length ? selection : [id]);
    }
  };

  keyHandler.current = onKeyDown;

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const listener = (event: KeyboardEvent) => keyHandler.current(event, container);
    container.addEventListener("keydown", listener);
    return () => container.removeEventListener("keydown", listener);
  }, []);

  const renderNode = (node: FolderNode, depth: number): ReactNode => (
    <>
      {[...node.folders.values()].map((child) => (
        <TaskListFolder
          key={child.path}
          name={child.name}
          count={child.count}
          depth={depth}
          open={isOpen(child.path)}
          onToggle={() => toggleFolder(child.path)}
        >
          {renderNode(child, depth + 1)}
        </TaskListFolder>
      ))}
      {node.tasks.map((summary) => (
        <TaskListItem
          key={summary.task.id}
          summary={summary}
          depth={depth}
          active={summary.task.id === selectedId}
          checked={selection.includes(summary.task.id)}
          selectionMode={selection.length > 0}
          now={now}
          onOpen={(event) => open(summary.task.id, event)}
          onCheck={() => {
            anchor.current = summary.task.id;
            toggleSelected(summary.task.id);
          }}
        />
      ))}
    </>
  );

  return (
    <section aria-label="Tasks" className="flex h-full min-h-0 flex-col bg-sidebar/40">
      <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2.5">
        <InputGroup className="h-8">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tasks durchsuchen …"
            aria-label="Tasks durchsuchen"
            className="text-[13px]"
          />
          {search && (
            <InputGroupAddon align="inline-end">
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Suche leeren"
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </InputGroupAddon>
          )}
        </InputGroup>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip label="Ordner" value={folderFilter}>
            {option(!folderFilter, () => setFolderFilter(null), "Alle Ordner")}
            {folders.length > 0 && <DropdownMenuSeparator />}
            {folders.map((folder) =>
              option(
                folderFilter === folder,
                () => setFolderFilter(folder),
                folder.replaceAll("/", " / "),
                folder,
              ),
            )}
          </FilterChip>
          <FilterChip label="Tag" value={tagFilter}>
            {option(!tagFilter, () => setTagFilter(null), "Alle Tags")}
            {tags.length > 0 && <DropdownMenuSeparator />}
            {tags.length === 0 && <DropdownMenuLabel>Noch keine Tags</DropdownMenuLabel>}
            {tags.map((tag) => option(tagFilter === tag, () => setTagFilter(tag), tag, tag))}
          </FilterChip>
          <FilterChip
            label="Status"
            value={
              statusFilter === "all"
                ? null
                : (STATUS_OPTIONS.find((entry) => entry.value === statusFilter)?.label ?? null)
            }
          >
            {STATUS_OPTIONS.map((entry) =>
              option(
                statusFilter === entry.value,
                () => setStatusFilter(entry.value),
                entry.label,
                entry.value,
              ),
            )}
          </FilterChip>
          {chipFiltering && (
            <button
              type="button"
              onClick={() => {
                setFolderFilter(null);
                setTagFilter(null);
                setStatusFilter("all");
              }}
              className="ml-auto rounded-sm px-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Zurücksetzen
            </button>
          )}
        </div>
      </div>
      <div
        ref={listRef}
        data-testid="automation-task-list"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5 [scrollbar-gutter:stable]"
      >
        {draft && <TaskListDraftItem name={draft.name} />}
        {visible.length === 0 ? (
          tasks.length === 0 && draft ? null : (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
                <SearchXIcon aria-hidden className="size-4" />
              </span>
              <p className="text-sm font-medium">Keine Treffer</p>
              <p className="text-xs text-pretty text-muted-foreground">
                Kein Task passt zu Suche und Filtern.
              </p>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-px">{renderNode(tree, 0)}</div>
        )}
      </div>
      <TaskBulkBar />
    </section>
  );
}
