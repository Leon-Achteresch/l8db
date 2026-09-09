addEventListener("message", function initialize(event) {
  if (event.source !== parent || !event.ports[0]) return;
  removeEventListener("message", initialize);
  const port = event.ports[0];
  const url = URL.createObjectURL(new Blob([event.data.bootstrap], { type: "text/javascript" }));
  let worker;
  try {
    worker = new Worker(url);
  } catch (error) {
    port.postMessage({ type: "crash", error: String(error) });
    return;
  }
  worker.onmessage = (event) => port.postMessage(event.data);
  worker.onerror = (event) => port.postMessage({ type: "crash", error: event.message });
  port.onmessage = (event) => {
    if (event.data.type === "terminate") {
      worker.terminate();
      URL.revokeObjectURL(url);
      port.close();
    } else worker.postMessage(event.data);
  };
  port.start();
  addEventListener("pagehide", () => worker.terminate());
});
