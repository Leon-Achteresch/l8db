const BRIDGE = "http://127.0.0.1:27021";
const VITE_STUB = await Bun.file(
  new URL("./clickhouse-browser-vite-stub.js", import.meta.url),
).text();
const shim = `
(() => {
  const BRIDGE = ${JSON.stringify(BRIDGE)};
  const remote = new Set(["test_connection_string","list_databases","list_schemas","list_tables","list_views","list_functions","get_function_definition","get_view_definition","update_view_definition","list_all_columns","list_table_columns_detailed","fetch_table_rows","count_table_rows","count_table_rows_capped","execute_query","explain_query","get_database_overview","create_table","preview_create_table_ddl","list_indexes","list_constraints","list_foreign_keys","list_materialized_views","add_column","alter_column","drop_column","truncate_table","drop_table","create_schema","drop_schema"]);
  const NativeWS = window.WebSocket; window.WebSocket = function(url, p){ if (String(url).includes("token=")) { return { readyState: 0, send(){}, close(){}, addEventListener(){}, removeEventListener(){}, set onopen(v){}, set onmessage(v){}, set onclose(v){}, set onerror(v){} }; } return new NativeWS(url, p); };
  const calls = []; const errors = []; window.__L8DB_ERRORS__ = errors; window.addEventListener("error", function(e){ errors.push(String(e.message) + " @ " + (e.filename || "")); }); window.addEventListener("unhandledrejection", function(e){ errors.push("rej: " + String((e.reason && e.reason.message) || e.reason)); });
  window.__L8DB_CALLS__ = calls;
  let providers = null;
  const providersPromise = fetch(BRIDGE, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({command:"list_providers",args:{}})}).then(r=>r.json()).then(r=>{providers=r.result; return r.result;});
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => { const id = Math.floor(Math.random()*1e9); window["_" + id] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "list_providers") return providers ?? (await providersPromise);
      if (remote.has(command)) {
        const res = await fetch(BRIDGE, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({command, args: args ?? {}})}).then(r=>r.json());
        if (res.error) throw new Error(res.error);
        return res.result;
      }
      if (command === "load_secret") return null;
      if (command === "driver_status") return { available: true };
      if (command.startsWith("list_") || command.startsWith("search_")) return [];
      return null;
    },
  };
  if (!localStorage.getItem("l8db.connections")) {
    localStorage.setItem("l8db.connections", JSON.stringify({state:{connections:[{id:"ch",name:"ClickHouse · Test",kind:"clickhouse",connectionString:"clickhouse://l8db:l8db@localhost:8124/bigdata",sslMode:"disable"}],activeId:"ch",favoriteServerKeys:[],serverOrder:[]},version:0}));
    localStorage.setItem("l8db.settings", JSON.stringify({state:{tourFinished:true,onboardingDone:true},version:0}));
    localStorage.setItem("l8db.db-selection", JSON.stringify({state:{database:"bigdata",schema:"bigdata"},version:0}));
  }
})();
`;
Bun.serve({
  port: 1421,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/__shim.js")
      return new Response(shim, { headers: { "content-type": "text/javascript" } });
    const target = "http://localhost:1420" + url.pathname + url.search;
    const res = await fetch(target, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      redirect: "manual",
      duplex: "half",
    });
    const type = res.headers.get("content-type") ?? "";
    const nh = new Headers(res.headers);
    nh.set("cache-control", "no-store");
    if (!type.includes("text/html"))
      return new Response(res.body, { status: res.status, headers: nh });
    const html = (await res.text()).replace("<head>", '<head><script src="/__shim.js"></script>');
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.set("cache-control", "no-store");
    return new Response(html, { status: res.status, headers });
  },
});
console.log("proxy on 1421");
