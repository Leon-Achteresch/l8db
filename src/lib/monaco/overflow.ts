export const overflowWidgetsDomNode: HTMLElement = (() => {
  const node = document.createElement("div");
  node.className = "monaco-editor";
  document.body.appendChild(node);
  return node;
})();
