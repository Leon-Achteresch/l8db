import { Link, useNavigate } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArchiveIcon,
  EllipsisIcon,
  ListIcon,
  type LucideIcon,
  PlusIcon,
  RadioIcon,
  UploadIcon,
} from "lucide-react";
import { IconMenu, IconMenuContent, IconMenuItem } from "@/components/icon-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { useActiveCapabilities } from "@/lib/db-selection";
import { useSettingsStore } from "@/lib/settings";

interface SidebarFooterActionsProps {
  caps: ReturnType<typeof useActiveCapabilities>;
}

type FooterAction = {
  to: "/import" | "/backup" | "/create-table" | "/sessions" | "/replication" | "/enums";
  label: string;
  icon: LucideIcon;
};

export function SidebarFooterActions({ caps }: SidebarFooterActionsProps) {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const navigate = useNavigate();
  const actions: FooterAction[] = [
    ...(caps.query_language === "sql" && !caps.object_storage
      ? [{ to: "/import", label: "SQL importieren", icon: UploadIcon } as const]
      : []),
    ...(caps.backup
      ? [{ to: "/backup", label: "Sichern & Wiederherstellen", icon: ArchiveIcon } as const]
      : []),
    ...(caps.ddl
      ? [
          {
            to: "/create-table",
            label: caps.query_language === "json" ? "Collection erstellen" : "Tabelle erstellen",
            icon: PlusIcon,
          } as const,
        ]
      : []),
    ...(!easyMode && caps.sessions
      ? [{ to: "/sessions", label: "Sitzungen & Locks", icon: ActivityIcon } as const]
      : []),
    ...(!easyMode && caps.replication
      ? [{ to: "/replication", label: "Replikation", icon: RadioIcon } as const]
      : []),
    ...(!easyMode && caps.enums
      ? [{ to: "/enums", label: "Enum-Typen", icon: ListIcon } as const]
      : []),
  ];
  if (!actions.length) return null;
  const [first, ...more] = actions;

  return (
    <div className="flex shrink-0 items-center gap-1 border-t p-2">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-8 min-w-0 flex-1 justify-start gap-2 px-2 font-normal"
      >
        <Link to={first.to}>
          <first.icon className="size-4 text-muted-foreground" />
          <span className="truncate">{first.label}</span>
        </Link>
      </Button>
      {more.length ? (
        <IconMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 font-normal">
              <EllipsisIcon className="size-4 text-muted-foreground" />
              Mehr
            </Button>
          </DropdownMenuTrigger>
          <IconMenuContent side="top">
            {more.map((action) => (
              <IconMenuItem
                key={action.to}
                icon={<action.icon />}
                label={action.label}
                onSelect={() => void navigate({ to: action.to })}
              />
            ))}
          </IconMenuContent>
        </IconMenu>
      ) : null}
    </div>
  );
}
