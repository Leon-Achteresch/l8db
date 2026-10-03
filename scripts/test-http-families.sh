#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
prefix="l8db-http-test-$$"
families="${L8DB_HTTP_FAMILIES:-elasticsearch opensearch influxdb2 influxdb3 libsql}"
token=l8db-lab-token
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

stop() {
  docker rm -f -v "$prefix-$1" >/dev/null
}

wait_http() {
  for _ in $(seq 1 180); do
    curl -sf -o /dev/null "$@" && return 0
    sleep 1
  done
  echo "Service did not start: $*" >&2
  return 1
}

run_test() {
  (cd src-tauri && env "$@" cargo test --lib "$TEST_NAME" -- --ignored --test-threads=1 --nocapture) 2>&1 | tee /tmp/"$prefix".log
  grep -q ": ok$" /tmp/"$prefix".log || {
    echo "$TEST_NAME did not exercise a live endpoint" >&2
    return 1
  }
}

seed_search() {
  local base=$1
  curl -sf -X PUT "$base/logs" -H 'Content-Type: application/json' --data-binary '{
    "mappings": {"properties": {
      "user": {"properties": {"name": {"type": "text"}, "age": {"type": "integer"}}},
      "level": {"type": "keyword"},
      "message": {"type": "text"}
    }}}' >/dev/null
  curl -sf -X POST "$base/_bulk?refresh=true" -H 'Content-Type: application/x-ndjson' --data-binary $'{"index":{"_index":"logs","_id":"1"}}\n{"user":{"name":"Ada Lovelace","age":36},"level":"info","message":"engine started"}\n{"index":{"_index":"logs","_id":"2"}}\n{"user":{"name":"Bob","age":25},"level":"warn","message":"disk err detected"}\n{"index":{"_index":"logs","_id":"3"}}\n{"user":{"name":"Carol","age":52},"level":"error","message":"a warning was logged"}\n' >/dev/null
  curl -sf -X POST "$base/_aliases" -H 'Content-Type: application/json' \
    --data-binary '{"actions":[{"add":{"index":"logs","alias":"logs_alias"}}]}' >/dev/null
  curl -sf -X PUT "$base/big" -H 'Content-Type: application/json' \
    --data-binary '{"mappings":{"properties":{"n":{"type":"integer"}}}}' >/dev/null
  local bulk
  bulk=$(mktemp)
  for n in $(seq 0 10049); do printf '{"index":{}}\n{"n":%d}\n' "$n"; done >"$bulk"
  curl -sf -X POST "$base/big/_bulk?refresh=true" -H 'Content-Type: application/x-ndjson' --data-binary @"$bulk" >/dev/null
  rm -f "$bulk"
}

influx_points() {
  local now
  now=$(date +%s)
  printf 'cpu,host=web1,region=us usage=10.5 %d000000000\n' $((now - 1800))
  printf 'cpu,host=web2,region=eu-west usage=30 %d000000000\n' $((now - 1200))
  printf 'cpu,host=web1,region=eu usage=70.25 %d000000000\n' $((now - 600))
  printf 'mem,host=web1 used=1024i %d000000000\n' $((now - 600))
}

for family in $families; do
  case "$family" in
    elasticsearch)
      start es -p 127.0.0.1:19200:9200 -e discovery.type=single-node -e xpack.security.enabled=false \
        -e ES_JAVA_OPTS="-Xms512m -Xmx512m" "${L8DB_ELASTICSEARCH_IMAGE:-docker.elastic.co/elasticsearch/elasticsearch:8.19.4}"
      wait_http "http://127.0.0.1:19200/_cluster/health?wait_for_status=yellow&timeout=1s"
      seed_search http://127.0.0.1:19200
      TEST_NAME=elasticsearch_and_opensearch_live run_test L8DB_SMOKE_ELASTICSEARCH_URL=elasticsearch://127.0.0.1:19200
      stop es
      ;;
    opensearch)
      start os -p 127.0.0.1:19201:9200 -e discovery.type=single-node -e DISABLE_SECURITY_PLUGIN=true \
        -e DISABLE_INSTALL_DEMO_CONFIG=true -e OPENSEARCH_JAVA_OPTS="-Xms512m -Xmx512m" \
        "${L8DB_OPENSEARCH_IMAGE:-opensearchproject/opensearch:2}"
      wait_http "http://127.0.0.1:19201/_cluster/health?wait_for_status=yellow&timeout=1s"
      seed_search http://127.0.0.1:19201
      TEST_NAME=elasticsearch_and_opensearch_live run_test L8DB_E2E_OPENSEARCH_URL=opensearch://127.0.0.1:19201
      stop os
      ;;
    influxdb2)
      start influx2 -p 127.0.0.1:18086:8086 -e DOCKER_INFLUXDB_INIT_MODE=setup \
        -e DOCKER_INFLUXDB_INIT_USERNAME=l8db -e DOCKER_INFLUXDB_INIT_PASSWORD=l8db-lab-pw \
        -e DOCKER_INFLUXDB_INIT_ORG=l8db -e DOCKER_INFLUXDB_INIT_BUCKET=metrics \
        -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN="$token" "${L8DB_INFLUXDB2_IMAGE:-influxdb:2.7}"
      wait_http -H "Authorization: Token $token" "http://127.0.0.1:18086/api/v2/buckets?name=metrics"
      until curl -sf -H "Authorization: Token $token" "http://127.0.0.1:18086/api/v2/buckets?name=metrics" | grep -q '"name": "metrics"'; do sleep 1; done
      influx_points | curl -sf -X POST -H "Authorization: Token $token" --data-binary @- \
        "http://127.0.0.1:18086/api/v2/write?org=l8db&bucket=metrics&precision=ns"
      TEST_NAME=influxdb_v2_and_v3_live run_test \
        "L8DB_SMOKE_INFLUXDB_URL=influxdb://token:$token@127.0.0.1:18086/metrics?org=l8db"
      stop influx2
      ;;
    influxdb3)
      start influx3 -p 127.0.0.1:18181:8181 "${L8DB_INFLUXDB3_IMAGE:-influxdb:3-core}" influxdb3 serve \
        --node-id l8db --object-store memory --without-auth
      wait_http http://127.0.0.1:18181/health
      influx_points | curl -sf -X POST --data-binary @- "http://127.0.0.1:18181/api/v3/write_lp?db=metrics&precision=nanosecond"
      TEST_NAME=influxdb_v2_and_v3_live run_test \
        "L8DB_E2E_INFLUXDB3_URL=influxdb://token:$token@127.0.0.1:18181/metrics?version=3"
      stop influx3
      ;;
    libsql)
      start libsql -p 127.0.0.1:18080:8080 "${L8DB_LIBSQL_IMAGE:-ghcr.io/tursodatabase/libsql-server:latest}"
      wait_http http://127.0.0.1:18080/health
      TEST_NAME=libsql_live run_test "L8DB_SMOKE_SQLITEHTTP_URL=libsql://127.0.0.1:18080?tls=false"
      stop libsql
      ;;
    *)
      echo "Unknown family: $family" >&2
      exit 1
      ;;
  esac
done
