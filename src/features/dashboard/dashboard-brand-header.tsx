import type { DashboardTheme } from "@/lib/dashboards";
import { isImageDataUrl } from "@/lib/dashboards";

export function DashboardBrandHeader({
  theme,
  fallbackName,
}: {
  theme: DashboardTheme;
  fallbackName: string;
}) {
  const logo = isImageDataUrl(theme.logo) ? theme.logo : null;
  return (
    <header className="dashboard-header flex shrink-0 items-center gap-4 px-6 pt-5 pb-3">
      {logo && (
        <img
          src={logo}
          alt=""
          draggable={false}
          className="dashboard-header-logo h-11 max-w-48 shrink-0 object-contain"
        />
      )}
      <div className="min-w-0">
        <h1 className="dashboard-header-title truncate text-xl font-semibold tracking-tight text-foreground">
          {theme.brand || fallbackName}
        </h1>
        {theme.tagline && (
          <p className="dashboard-header-tagline truncate text-sm text-muted-foreground">
            {theme.tagline}
          </p>
        )}
      </div>
    </header>
  );
}
