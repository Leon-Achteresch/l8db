#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

dir="${L8DB_E2E_PG_TLS_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/l8db-tls.XXXXXX")}"
prefix="${L8DB_TLS_LAB_PREFIX:-l8db-tls-lab}"
pg_port="${L8DB_E2E_PG_TLS_PORT:-55460}"
mysql_plain_port="${L8DB_E2E_MYSQL_PLAIN_PORT:-53306}"
mysql_tls_port="${L8DB_E2E_MYSQL_TLS_PORT:-53307}"
cassandra_port="${L8DB_E2E_CASSANDRA_TLS_PORT:-9042}"
openssl="${OPENSSL:-$(command -v /opt/homebrew/bin/openssl || command -v openssl)}"
containers=("$prefix-pg" "$prefix-mariadb-plain" "$prefix-mariadb-tls" "$prefix-cassandra")

cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    for container in "${containers[@]}"; do docker logs --tail 40 "$container" 2>&1 || true; done
  fi
  if [ "${L8DB_TLS_LAB_KEEP:-0}" != 1 ]; then
    docker rm -f -v "${containers[@]}" >/dev/null 2>&1 || true
  fi
  exit "$result"
}
trap cleanup EXIT

mkdir -p "$dir"
cd "$dir"

"$openssl" req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=l8db test CA" \
  -keyout ca.key -out ca.pem 2>/dev/null

server_cert() {
  name=$1
  san=$2
  "$openssl" req -newkey rsa:2048 -nodes -subj "/CN=$name" -keyout "$name.key" -out "$name.csr" 2>/dev/null
  printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$san" >"$name.ext"
  "$openssl" x509 -req -in "$name.csr" -CA ca.pem -CAkey ca.key -CAcreateserial -days 30 \
    -extfile "$name.ext" -out "$name.pem" 2>/dev/null
}

server_cert pg DNS:pg.l8db.test
server_cert mariadb DNS:mariadb.l8db.test
server_cert cassandra DNS:localhost

"$openssl" genrsa -traditional -out client.key 2048 2>/dev/null
"$openssl" req -new -key client.key -subj "/CN=certuser" -out client.csr
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n' >client.ext
"$openssl" x509 -req -in client.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 30 \
  -extfile client.ext -out client.pem 2>/dev/null
"$openssl" pkcs8 -topk8 -nocrypt -in client.key -out client.pk8.pem
"$openssl" pkcs12 -export -legacy -in client.pem -inkey client.key -certfile ca.pem \
  -name certuser -passout pass:secret -out client.p12
"$openssl" pkcs12 -export -legacy -in cassandra.pem -inkey cassandra.key -certfile ca.pem \
  -name cassandra -passout pass:keystorepw -out cassandra.p12

printf 'local all all trust\nhostssl all certuser all cert\nhost all postgres all scram-sha-256\n' >pg_hba.conf
printf '[mysqld]\nssl_ca=/tls/ca.pem\nssl_cert=/tls/mariadb.pem\nssl_key=/tls/mariadb.key\n' >mariadb-tls.cnf
chmod 644 ./*.pem ./*.key ./*.p12 ./*.conf ./*.cnf

docker rm -f -v "${containers[@]}" >/dev/null 2>&1 || true

docker run -d --name "$prefix-pg" -p "127.0.0.1:$pg_port:5432" -e POSTGRES_PASSWORD=testpw \
  -v "$dir:/tls-src:ro" --entrypoint /bin/sh postgres:18 -c \
  'mkdir -p /tls && cp /tls-src/pg.pem /tls-src/pg.key /tls-src/ca.pem /tls-src/pg_hba.conf /tls/ && chown -R postgres /tls && chmod 600 /tls/pg.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/pg.pem -c ssl_key_file=/tls/pg.key -c ssl_ca_file=/tls/ca.pem -c hba_file=/tls/pg_hba.conf' >/dev/null

docker run -d --name "$prefix-mariadb-plain" -p "127.0.0.1:$mysql_plain_port:3306" \
  -e MARIADB_ROOT_PASSWORD=testpw mariadb:10.11 --skip-ssl >/dev/null

docker run -d --name "$prefix-mariadb-tls" -p "127.0.0.1:$mysql_tls_port:3306" \
  -e MARIADB_ROOT_PASSWORD=testpw -v "$dir:/tls:ro" \
  -v "$dir/mariadb-tls.cnf:/etc/mysql/conf.d/tls.cnf:ro" mariadb:10.11 >/dev/null

docker run -d --name "$prefix-cassandra" -p "127.0.0.1:$cassandra_port:$cassandra_port" \
  -e CASSANDRA_BROADCAST_RPC_ADDRESS=127.0.0.1 -e MAX_HEAP_SIZE=512M -e HEAP_NEWSIZE=128M \
  -v "$dir:/tls:ro" --entrypoint /bin/sh cassandra:5 -c \
  "sed -i -e 's/^native_transport_port: .*/native_transport_port: $cassandra_port/' -e '/^client_encryption_options:/,/^[a-z]/{s/^  enabled: false/  enabled: true/;s/^  # optional: true/  optional: false/;s/^  optional: true/  optional: false/;s|^  keystore: .*|  keystore: /tls/cassandra.p12|;s/^  #\{0,1\}keystore_password: .*/  keystore_password: keystorepw\n  store_type: PKCS12/}' /etc/cassandra/cassandra.yaml && exec docker-entrypoint.sh cassandra -f" >/dev/null

wait_for() {
  label=$1
  shift
  for _ in $(seq 1 180); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  printf '%s did not become ready\n' "$label" >&2
  return 1
}

wait_for postgres docker exec -e PGPASSWORD=testpw "$prefix-pg" psql -U postgres -h 127.0.0.1 -c 'SELECT 1'
docker exec "$prefix-pg" psql -U postgres -c 'CREATE ROLE certuser LOGIN' >/dev/null
wait_for mariadb-plain docker exec "$prefix-mariadb-plain" mariadb -uroot -ptestpw -h 127.0.0.1 -e 'SELECT 1'
wait_for mariadb-tls docker exec "$prefix-mariadb-tls" mariadb -uroot -ptestpw -h 127.0.0.1 -e 'SELECT 1'
docker exec "$prefix-mariadb-tls" mariadb -uroot -ptestpw -e "CREATE USER 'certuser'@'%' REQUIRE X509; GRANT SELECT ON mysql.* TO 'certuser'@'%'"
wait_for cassandra sh -c "docker logs $prefix-cassandra 2>&1 | grep -q 'Starting listening for CQL clients'"

export L8DB_E2E_PG_TLS_DIR="$dir" L8DB_E2E_PG_TLS_PORT="$pg_port"
export L8DB_E2E_MYSQL_PLAIN_PORT="$mysql_plain_port" L8DB_E2E_MYSQL_TLS_PORT="$mysql_tls_port"
export L8DB_E2E_CASSANDRA_TLS_PORT="$cassandra_port"
cd - >/dev/null
for suite in db::connection::tests::live_tls_modes_and_client_certificates db::mysql::tests::live_tls_modes_fallback_and_client_certificates db::cassandra::tests::live_tls_modes; do
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib "$suite" -- --ignored --exact --test-threads=1 --nocapture
done
