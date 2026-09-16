const sheets = new Map();
export function createHotContext(){return {accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}
export function updateStyle(id, content){
  let el = sheets.get(id);
  if (!el) { el = document.createElement("style"); el.setAttribute("data-vite-dev-id", id); document.head.appendChild(el); sheets.set(id, el); }
  el.textContent = content;
}
export function removeStyle(id){ const el = sheets.get(id); if (el) { el.remove(); sheets.delete(id); } }
export function injectQuery(u){return u}
export const ErrorOverlay = class {};
