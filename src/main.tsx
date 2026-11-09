import "./index.css";
import { initAppStorage, STORAGE_FALLBACK_KEY } from "@/lib/app-storage";

function showStorageFailure() {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `<div style="height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;color-scheme:light dark;background:Canvas;color:CanvasText">
  <div style="display:grid;gap:12px;justify-items:center;text-align:center">
    <strong style="font-size:16px">Gespeicherte Daten nicht erreichbar</strong>
    <div style="display:flex;gap:8px">
      <button type="button" data-action="retry" style="padding:6px 14px;border-radius:999px;cursor:pointer">Erneut versuchen</button>
      <button type="button" data-action="fallback" style="padding:6px 14px;border-radius:999px;cursor:pointer;opacity:.75">Ohne gespeicherte Daten starten</button>
    </div>
  </div>
</div>`;
  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).dataset.action;
    if (action === "fallback") sessionStorage.setItem(STORAGE_FALLBACK_KEY, "1");
    if (action) window.location.reload();
  });
}

void initAppStorage().then((mode) => {
  if (mode === "failed") showStorageFailure();
  else void import("./bootstrap");
});
