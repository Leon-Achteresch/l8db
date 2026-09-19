import { Link } from "@tanstack/react-router";
import { DriverDetail } from "@/components/driver-detail";
import type { DatabaseKind, ProviderInfo } from "@/lib/db";
import { refreshDriverStatus } from "@/lib/providers";
import type { Mode } from "./types";

export function DriverMissingNotice({
  activeInfo,
  mode,
  quickKind,
  kind,
}: {
  activeInfo: ProviderInfo;
  mode: Mode;
  quickKind: DatabaseKind;
  kind: DatabaseKind;
}) {
  return (
    <div
      role="status"
      className="space-y-1 rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300"
    >
      <DriverDetail detail={activeInfo.driver_status.detail} className="block" />
      <div className="flex gap-3">
        <button
          type="button"
          className="underline"
          onClick={() =>
            void refreshDriverStatus(mode === "string" ? quickKind : kind).catch(() => undefined)
          }
        >
          Erneut prüfen
        </button>
        <Link to="/drivers" className="underline">
          Treiber
        </Link>
      </div>
    </div>
  );
}
