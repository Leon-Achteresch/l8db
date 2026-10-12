import {
  ArrowLeftIcon,
  ArrowRightIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { type DashboardPage, MAX_PAGES, movePage } from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

export function DashboardPageNav({
  pages,
  active,
  editing,
  vertical,
  onSelect,
  onChange,
  onAdd,
  onRemove,
}: {
  pages: DashboardPage[];
  active: string;
  editing: boolean;
  vertical: boolean;
  onSelect: (id: string) => void;
  onChange: (pages: DashboardPage[]) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("dashboard.pages");
  const visible = editing ? pages : pages.filter((page) => !page.hidden || page.id === active);
  if (!editing && visible.length < 2) return null;
  const rename = (id: string, name: string) => {
    const trimmed = name.trim().slice(0, 60);
    if (trimmed)
      onChange(pages.map((page) => (page.id === id ? { ...page, name: trimmed } : page)));
    setRenaming(null);
  };
  return (
    <nav
      aria-label="Dashboard-Seiten"
      className={cn(
        "dashboard-nav flex shrink-0 gap-1",
        vertical
          ? "w-52 flex-col overflow-y-auto border-r px-2 py-3"
          : "items-center overflow-x-auto border-b px-4",
      )}
    >
      {visible.map((page, index) => {
        const selected = page.id === active;
        return (
          <div
            key={page.id}
            className={cn(
              "group/page flex shrink-0 items-center",
              vertical ? "w-full" : "h-10",
              !vertical && selected && "shadow-[inset_0_-2px_0_var(--dash-accent)]",
            )}
          >
            {renaming === page.id ? (
              <Input
                autoFocus
                aria-label="Seitenname"
                defaultValue={page.name}
                maxLength={60}
                className="h-7 w-40 text-xs"
                onBlur={(e) => rename(page.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(page.id, e.currentTarget.value);
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelect(page.id)}
                onDoubleClick={() => editing && setRenaming(page.id)}
                className={cn(
                  "dashboard-nav-item flex min-w-0 items-center gap-1.5 truncate rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  vertical && "flex-1 text-left",
                  selected
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  vertical &&
                    selected &&
                    "bg-[color-mix(in_oklab,var(--dash-accent)_14%,transparent)]",
                  page.hidden && "opacity-60",
                )}
              >
                {page.hidden && <EyeOffIcon className="size-3.5 shrink-0" />}
                <span className="truncate">{page.name}</span>
              </button>
            )}
            {editing && renaming !== page.id && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Seite ${page.name} bearbeiten`}
                    className="opacity-0 group-hover/page:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  >
                    <EllipsisVerticalIcon />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem onSelect={() => setRenaming(page.id)}>
                    <PencilIcon /> Umbenennen
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() => onChange(movePage(pages, page.id, -1))}
                  >
                    <ArrowLeftIcon /> {vertical ? "Nach oben" : "Nach links"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === pages.length - 1}
                    onSelect={() => onChange(movePage(pages, page.id, 1))}
                  >
                    <ArrowRightIcon /> {vertical ? "Nach unten" : "Nach rechts"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      onChange(
                        pages.map((p) => (p.id === page.id ? { ...p, hidden: !p.hidden } : p)),
                      )
                    }
                  >
                    {page.hidden ? <EyeIcon /> : <EyeOffIcon />}
                    {page.hidden ? "In Navigation zeigen" : "Nur über Buttons erreichbar"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={pages.length < 2}
                    onSelect={() => {
                      if (window.confirm(`Seite „${page.name}“ mit allen Inhalten löschen?`))
                        onRemove(page.id);
                    }}
                  >
                    <Trash2Icon /> Seite löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
      {editing && pages.length < MAX_PAGES && (
        <button
          ref={feature.ref}
          type="button"
          onClick={onAdd}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
            vertical && "w-full",
          )}
        >
          <PlusIcon className="size-3.5" /> Seite
          {feature.isNew && <NewBadge />}
        </button>
      )}
    </nav>
  );
}
