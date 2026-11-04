import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export function createRelayServer(handler) {
  const server = createServer(async (incoming, outgoing) => {
    const abort = new AbortController();
    incoming.once("aborted", () => abort.abort());
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) abort.abort();
    });
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value != null) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const request = new Request(new URL(incoming.url, "http://localhost"), {
        method: incoming.method,
        headers,
        signal: abort.signal,
        ...(incoming.method === "GET" || incoming.method === "HEAD"
          ? {}
          : { body: Readable.toWeb(incoming), duplex: "half" }),
      });
      const response = await handler.fetch(request, incoming.socket.remoteAddress ?? "unknown");
      if (outgoing.destroyed) return;
      if (response.status >= 400) outgoing.setHeader("connection", "close");
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body), outgoing, { signal: abort.signal });
      } else {
        outgoing.end();
      }
    } catch {
      if (!outgoing.headersSent && !outgoing.destroyed) {
        outgoing.writeHead(abort.signal.aborted ? 499 : 500, { connection: "close" });
        outgoing.end();
      } else {
        outgoing.destroy();
      }
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 64;
  return server;
}
