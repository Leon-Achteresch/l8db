import type { Dashboard, DashboardPage, Widget } from "./model";

export const DEFAULT_PAGE: DashboardPage = { id: "main", name: "Übersicht" };
export const MAX_PAGES = 30;

export function dashboardPages(dashboard: Pick<Dashboard, "pages">): DashboardPage[] {
  return dashboard.pages?.length ? dashboard.pages : [DEFAULT_PAGE];
}

export function pageOf(widget: Pick<Widget, "page">, pages: DashboardPage[]): string {
  const id = widget.page;
  return id && pages.some((page) => page.id === id) ? id : pages[0].id;
}

export function widgetsOnPage<T extends Pick<Widget, "page">>(
  widgets: T[],
  pages: DashboardPage[],
  pageId: string,
): T[] {
  return widgets.filter((widget) => pageOf(widget, pages) === pageId);
}

export function pageSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "seite";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function addPage(dashboard: Pick<Dashboard, "pages">, name: string): DashboardPage[] {
  const pages = dashboardPages(dashboard);
  if (pages.length >= MAX_PAGES) return pages;
  const label = name.trim() || `Seite ${pages.length + 1}`;
  return [
    ...pages,
    {
      id: pageSlug(
        label,
        pages.map((page) => page.id),
      ),
      name: label,
    },
  ];
}

export function removePage(
  dashboard: Pick<Dashboard, "pages" | "widgets" | "datasets">,
  pageId: string,
): Pick<Dashboard, "pages" | "widgets" | "datasets"> {
  const pages = dashboardPages(dashboard);
  if (pages.length <= 1) return dashboard;
  const next = pages.filter((page) => page.id !== pageId);
  const widgets = dashboard.widgets
    .filter((widget) => pageOf(widget, pages) !== pageId)
    .map((widget) =>
      widget.block?.page === pageId
        ? { ...widget, block: { ...widget.block, page: undefined } }
        : widget,
    );
  const used = new Set(widgets.map((widget) => widget.datasetId));
  return {
    pages: next,
    widgets,
    datasets: dashboard.datasets.filter((dataset) => used.has(dataset.id)),
  };
}

export function movePage(pages: DashboardPage[], pageId: string, offset: number): DashboardPage[] {
  const index = pages.findIndex((page) => page.id === pageId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= pages.length) return pages;
  const next = [...pages];
  const [page] = next.splice(index, 1);
  next.splice(target, 0, page);
  return next;
}
