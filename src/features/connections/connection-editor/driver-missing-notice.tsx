import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { DriverDetail } from "@/components/driver-detail";
import { type DatabaseKind, installDriver, type ProviderInfo } from "@/lib/db";
import { installsOwnDriver } from "@/lib/drivers";
import { loadProviders, providerById, refreshDriverStatus } from "@/lib/providers";
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
  const [installing, setInstalling] = useState(false);
  const product = installsOwnDriver(activeInfo);

  const install = async () => {
    setInstalling(true);
    try {
      await installDriver(activeInfo.kind, activeInfo.id);
      await loadProviders();
      if (providerById(activeInfo.id)?.driver_status.available)
        toast.success(`„${activeInfo.name}" installiert.`);
      else toast.warning("Installiert, aber noch nicht erkannt. Starte l8db neu.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      role="status"
      className="space-y-1 rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300"
    >
      <DriverDetail detail={activeInfo.driver_status.detail} className="block" />
      <div className="flex gap-3">
        {product && (
          <button
            type="button"
            disabled={installing}
            className="cursor-pointer font-medium underline disabled:cursor-default disabled:opacity-60"
            onClick={() => void install()}
          >
            {installing ? "Installiert …" : "Installieren"}
          </button>
        )}
        <button
          type="button"
          className="cursor-pointer underline"
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
