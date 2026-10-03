#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
prefix="l8db-workload-test-$$"
batches="${L8DB_WORKLOAD_BATCHES:-light oracle cassandra mssql}"
containers=()
cleanup() {
  result=$?
  for container in ${containers[@]+"${containers[@]}"}; do docker rm -f -v "$container" >/dev/null 2>&1 || true; done
  exit "$result"
}
trap cleanup EXIT

start() {
  local name="$prefix-$1"
  shift
  containers+=("$name")
  docker run -d --name "$name" "$@" >/dev/null
}

until_ready() {
  local label=$1
  shift
  for _ in $(seq 1 300); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "$label did not become ready" >&2
  return 1
}

stop_all() {
  for container in ${containers[@]+"${containers[@]}"}; do docker rm -f -v "$container" >/dev/null 2>&1 || true; done
  containers=()
}

run_kinds() {
  L8DB_WORKLOAD_LIVE=1 L8DB_WORKLOAD_LIVE_KINDS="$1" bun test tests/workload-live.test.ts
}

for batch in $batches; do
  case "$batch" in
    light)
      start postgres -p 127.0.0.1:15432:5432 -e POSTGRES_PASSWORD=testpw "${L8DB_POSTGRES_IMAGE:-postgres:18}" \
        -c shared_preload_libraries=pg_stat_statements
      start mysql -p 127.0.0.1:13306:3306 -e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=shop \
        "${L8DB_MYSQL_IMAGE:-mysql:8.4}"
      start clickhouse -p 127.0.0.1:18123:8123 -e CLICKHOUSE_USER=l8db -e CLICKHOUSE_PASSWORD=l8db \
        -e CLICKHOUSE_DB=shop "${L8DB_CLICKHOUSE_IMAGE:-clickhouse/clickhouse-server:latest}"
      start mongodb -p 127.0.0.1:17017:27017 "${L8DB_MONGODB_IMAGE:-mongo:8.0}"
      start redis -p 127.0.0.1:16379:6379 "${L8DB_REDIS_IMAGE:-valkey/valkey:8}"
      until_ready postgres docker exec "$prefix-postgres" psql -U postgres -h 127.0.0.1 -c "SELECT 1"
      until_ready mysql docker exec "$prefix-mysql" mysql -uroot -ptestpw -h127.0.0.1 -e "SELECT 1"
      until_ready clickhouse curl -sf "http://127.0.0.1:18123/?user=l8db&password=l8db" --data-binary "SELECT 1"
      until_ready mongodb docker exec "$prefix-mongodb" mongosh --quiet --eval "db.runCommand({ ping: 1 })"
      until_ready redis docker exec "$prefix-redis" valkey-cli ping
      run_kinds postgres,mysql,clickhouse,mongodb,redis
      ;;
    oracle)
      start oracle -p 127.0.0.1:15219:1521 -e ORACLE_PASSWORD=l8dbtest -e APP_USER=l8db \
        -e APP_USER_PASSWORD=l8dbtest "${L8DB_ORACLE_IMAGE:-gvenzl/oracle-free:23-slim}"
      until_ready oracle sh -c "docker logs $prefix-oracle 2>&1 | grep -q 'DATABASE IS READY TO USE'"
      run_kinds oracle
      ;;
    cassandra)
      start cassandra -p 127.0.0.1:9042:9042 -e CASSANDRA_BROADCAST_RPC_ADDRESS=127.0.0.1 \
        -e MAX_HEAP_SIZE=1G -e HEAP_NEWSIZE=256M "${L8DB_CASSANDRA_IMAGE:-cassandra:5}"
      until_ready cassandra docker exec "$prefix-cassandra" cqlsh -e "DESCRIBE KEYSPACES"
      L8DB_LIVE_CASSANDRA_URL=cassandra://127.0.0.1:9042 run_kinds cassandra
      ;;
    mssql)
      start mssql -p 127.0.0.1:14339:1433 -e ACCEPT_EULA=1 -e MSSQL_SA_PASSWORD=L8db-Test-pw1 \
        "${L8DB_MSSQL_IMAGE:-mcr.microsoft.com/azure-sql-edge:latest}"
      until_ready mssql nc -z 127.0.0.1 14339
      sleep 15
      run_kinds mssql
      ;;
    *)
      echo "Unknown batch: $batch" >&2
      exit 1
      ;;
  esac
  stop_all
done
