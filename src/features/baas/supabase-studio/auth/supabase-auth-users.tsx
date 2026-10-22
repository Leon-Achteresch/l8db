import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Link2, Mail, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SupabaseStudioCapabilities } from "@/lib/db/supabase-studio";
import {
  type SupabaseAuthUserFilter,
  type SupabaseAuthUserSort,
  supabaseStudioAuthUsers,
} from "@/lib/db/supabase-studio-auth";
import { SupabaseAuthCreateDialog } from "./supabase-auth-create-dialog";
import { formatAuthDate, isAuthBanned } from "./supabase-auth-format";
import { SupabaseAuthInviteDialog } from "./supabase-auth-invite-dialog";
import { SupabaseAuthLinkDialog } from "./supabase-auth-link-dialog";
import { SupabaseAuthUserSheet } from "./supabase-auth-user-sheet";

const FILTERS: { value: SupabaseAuthUserFilter; label: string }[] = [
  { value: "all", label: "Alle Benutzer" },
  { value: "confirmed", label: "Bestätigt" },
  { value: "unconfirmed", label: "Unbestätigt" },
  { value: "anonymous", label: "Anonym" },
  { value: "banned", label: "Gesperrt" },
];

const SORTS: { value: SupabaseAuthUserSort; label: string }[] = [
  { value: "created_desc", label: "Neueste zuerst" },
  { value: "created_asc", label: "Älteste zuerst" },
  { value: "last_sign_in_desc", label: "Letzte Anmeldung (neu)" },
  { value: "last_sign_in_asc", label: "Letzte Anmeldung (alt)" },
  { value: "email_asc", label: "E-Mail A–Z" },
];

interface Props {
  reference: string;
  capabilities: SupabaseStudioCapabilities;
}

export function SupabaseAuthUsers({ reference, capabilities }: Props) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SupabaseAuthUserFilter>("all");
  const [sort, setSort] = useState<SupabaseAuthUserSort>("created_desc");
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "invite" | "link" | null>(null);
  const users = useQuery({
    queryKey: ["supabase", reference, "studio-auth-users", page, search, filter, sort],
    queryFn: () => supabaseStudioAuthUsers(reference, page, search, filter, sort),
    placeholderData: keepPreviousData,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["supabase", reference, "studio-auth-users"] });
  const pageOnly =
    users.data && !users.data.server_side && (filter !== "all" || !sort.startsWith("created"));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-56 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <Input
            className="h-8 text-xs"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={
              capabilities.sql ? "E-Mail, Telefon, Name oder ID suchen" : "E-Mail oder Name suchen"
            }
            aria-label="Benutzer suchen"
          />
          <Button size="sm" variant="outline" type="submit" aria-label="Suchen">
            <Search className="size-3.5" />
          </Button>
        </form>
        <Select
          value={filter}
          onValueChange={(value) => {
            setFilter(value as SupabaseAuthUserFilter);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" aria-label="Filter" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(value) => {
            setSort(value as SupabaseAuthUserSort);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" aria-label="Sortierung" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDialog("create")}>
          <Plus className="size-3.5" /> Benutzer erstellen
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDialog("invite")}>
          <Mail className="size-3.5" /> Einladen
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDialog("link")}>
          <Link2 className="size-3.5" /> Link erzeugen
        </Button>
      </div>
      {pageOnly && (
        <p className="text-xs text-muted-foreground">
          Ohne SQL-Zugriff gelten Filter und Sortierung nur für die geladene Seite.
        </p>
      )}
      {users.isPending ? (
        <p className="text-xs text-muted-foreground">Benutzer werden geladen…</p>
      ) : users.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(users.error)}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Benutzer</th>
                  <th className="px-3 py-2 font-medium">Anbieter</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Erstellt</th>
                  <th className="px-3 py-2 font-medium">Letzte Anmeldung</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.data.users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      Keine Benutzer gefunden.
                    </td>
                  </tr>
                ) : (
                  users.data.users.map((user) => (
                    <tr
                      key={user.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelected(user.id)}
                    >
                      <td className="max-w-72 px-3 py-2">
                        <button
                          type="button"
                          className="block max-w-full truncate text-left font-medium hover:text-primary"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(user.id);
                          }}
                        >
                          {user.email || user.phone || "Ohne Kennung"}
                        </button>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {user.id}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {user.providers.map((provider) => (
                            <Badge key={provider} variant="outline">
                              {provider}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {isAuthBanned(user.banned_until) && (
                            <Badge variant="destructive">Gesperrt</Badge>
                          )}
                          {user.is_anonymous ? (
                            <Badge variant="secondary">Anonym</Badge>
                          ) : user.email_confirmed_at || user.phone_confirmed_at ? (
                            <Badge variant="secondary">Bestätigt</Badge>
                          ) : (
                            <Badge variant="outline">Unbestätigt</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatAuthDate(user.created_at)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {user.last_sign_in_at ? formatAuthDate(user.last_sign_in_at) : "Noch nie"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span className="mr-auto">
              Seite {page}
              {users.data.total != null && ` · ${users.data.total} Benutzer insgesamt`}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1 || users.isFetching}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft className="size-3.5" /> Zurück
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!users.data.has_more || users.isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              Weiter <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </>
      )}
      {selected && (
        <SupabaseAuthUserSheet
          key={selected}
          reference={reference}
          userId={selected}
          capabilities={capabilities}
          onClose={() => setSelected(null)}
        />
      )}
      <SupabaseAuthCreateDialog
        reference={reference}
        open={dialog === "create"}
        onOpenChange={(open) => setDialog(open ? "create" : null)}
        onCreated={(user) => {
          void refresh();
          setSelected(user.id);
        }}
      />
      <SupabaseAuthInviteDialog
        reference={reference}
        open={dialog === "invite"}
        onOpenChange={(open) => setDialog(open ? "invite" : null)}
        onInvited={() => void refresh()}
      />
      {dialog === "link" && (
        <SupabaseAuthLinkDialog
          reference={reference}
          open
          onOpenChange={(open) => setDialog(open ? "link" : null)}
          email=""
          onGenerated={() => void refresh()}
        />
      )}
    </div>
  );
}
