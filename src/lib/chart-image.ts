const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "opacity",
  "font-size",
  "font-family",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
];

export function chartSvgMarkup(container: HTMLElement | null): string | null {
  const svg = container?.querySelector("svg.chart-surface") ?? container?.querySelector("svg");
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = [svg, ...svg.querySelectorAll("*")];
  const target = [clone, ...clone.querySelectorAll("*")];
  source.forEach((element, index) => {
    const computed = getComputedStyle(element);
    const style = STYLE_PROPS.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`)
      .filter((entry) => !entry.endsWith(":"))
      .join(";");
    target[index]?.setAttribute("style", style);
  });
  const width = Math.round(rect.width) || Number(svg.getAttribute("width")) || 800;
  const height = Math.round(rect.height) || Number(svg.getAttribute("height")) || 400;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", getComputedStyle(container as HTMLElement).backgroundColor);
  clone.insertBefore(background, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

export async function svgToPng(markup: string, scale = 2): Promise<Blob> {
  const size = markup.match(/<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/);
  const width = Number(size?.[1] ?? 800);
  const height = Number(size?.[2] ?? 400);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Diagramm konnte nicht gerendert werden"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas nicht verfügbar");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG konnte nicht erzeugt werden"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyPng(png: Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
    throw new Error("Bilder können nicht in die Zwischenablage kopiert werden");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
