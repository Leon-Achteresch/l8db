export async function getFlowElement(): Promise<HTMLElement> {
  const el = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!el) throw new Error("React Flow viewport not found");
  return el;
}

export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
