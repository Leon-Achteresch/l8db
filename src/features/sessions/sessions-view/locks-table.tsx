import { Badge } from "@/components/ui/badge";
import type { LockInfo } from "@/lib/db";

export function LocksTable({ locks }: { locks: LockInfo[] | undefined }) {
  return (
    <>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">PID</th>
            <th className="px-3 py-2 font-medium">Typ</th>
            <th className="px-3 py-2 font-medium">Relation</th>
            <th className="px-3 py-2 font-medium">Modus</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {(locks ?? []).map((lock, index) => (
            <tr
              key={`${lock.pid}-${lock.lock_type}-${lock.relation ?? ""}-${lock.mode}-${index}`}
              className="hover:bg-muted/40"
            >
              <td className="px-3 py-2 font-mono tabular-nums">{lock.pid}</td>
              <td className="px-3 py-2 font-mono">{lock.lock_type}</td>
              <td className="px-3 py-2 font-mono">{lock.relation ?? "—"}</td>
              <td className="px-3 py-2 font-mono">{lock.mode}</td>
              <td className="px-3 py-2">
                <Badge
                  variant={lock.granted ? "secondary" : "destructive"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {lock.granted ? "gewährt" : "wartet"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(locks?.length ?? 0) === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">Keine Locks.</p>
      )}
    </>
  );
}
