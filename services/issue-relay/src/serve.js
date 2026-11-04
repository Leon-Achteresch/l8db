import { createRelayServer } from "./http.js";
import { createHandler, loadEnvironment } from "./self-hosted.js";

const server = createRelayServer(
  createHandler(await loadEnvironment(), {
    trustProxy: process.env.TRUST_PROXY === "1",
  }),
);
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
