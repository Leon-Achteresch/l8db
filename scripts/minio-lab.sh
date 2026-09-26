#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
compose=(docker compose -p l8db-minio -f tests/lab/minio/compose.yml)
if [ "${1:-up}" = down ]; then
  "${compose[@]}" down --volumes --remove-orphans
  exit 0
fi
port="${L8DB_MINIO_PORT:-9000}"
endpoint="http://127.0.0.1:$port"
user=l8dbadmin
secret=l8dbsecret
"${compose[@]}" up -d --wait --wait-timeout 120
for _ in $(seq 1 60); do
  curl -sf "$endpoint/minio/health/ready" >/dev/null && break
  sleep 1
done
s3() {
  local method=$1 path=$2
  shift 2
  curl -sS -f -X "$method" --aws-sigv4 "aws:amz:us-east-1:s3" --user "$user:$secret" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" "$@" "$endpoint/$path" >/dev/null
}
put() {
  local key=$1 type=$2
  shift 2
  s3 PUT "$key" -H "Content-Type: $type" "$@"
}
exists() {
  curl -s -o /dev/null -w '%{http_code}' -I --aws-sigv4 "aws:amz:us-east-1:s3" --user "$user:$secret" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" "$endpoint/$1"
}
if [ "$(exists demo)" != 200 ]; then
  s3 PUT demo
  s3 PUT versioned
  s3 PUT locked -H "x-amz-bucket-object-lock-enabled: true"
  s3 PUT "versioned?versioning" -H "Content-Type: application/xml" \
    --data-binary '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>'
  put demo/README.md text/markdown --data-binary $'# Demo bucket\n\nSeeded by scripts/minio-lab.sh for l8db.\n'
  put demo/data/customers.csv text/csv --data-binary $'id,name,city,revenue\n1,Alice,Berlin,1200.50\n2,Bob,Hamburg,830\n3,Carla,München,4410.25\n4,Deniz,Köln,99.90\n'
  put demo/data/orders.json application/json --data-binary '{"id":1,"customer":1,"total":49.9}
{"id":2,"customer":3,"total":120}
{"id":3,"customer":2,"total":15.5}'
  put demo/config/settings.json application/json -H "x-amz-meta-owner: l8db" -H "x-amz-meta-env: lab" \
    --data-binary '{"theme":"dark","retries":3,"features":["s3","minio"]}'
  put demo/images/pixel.png image/png --data-binary @public/logo.png
  put "demo/logs/2026/09/app.log" text/plain --data-binary $'2026-09-26T10:00:00Z INFO started\n2026-09-26T10:00:05Z WARN slow request\n'
  put "demo/empty-folder/" application/x-directory --data-binary ''
  for i in $(seq 1 1200); do printf 'row %d\n' "$i"; done | put demo/data/big.txt text/plain --data-binary @-
  for n in $(seq -w 1 60); do put "demo/many/item-$n.txt" text/plain --data-binary "item $n"; done
  put versioned/doc.txt text/plain --data-binary 'version 1'
  put versioned/doc.txt text/plain --data-binary 'version 2'
  put versioned/doc.txt text/plain --data-binary 'version 3'
  put locked/contract.txt text/plain --data-binary 'immutable contract'
fi
cat <<INFO
MinIO lab ready
  API:     $endpoint
  Console: http://127.0.0.1:${L8DB_MINIO_CONSOLE_PORT:-9001}  ($user / $secret)
  l8db:    s3://$user:$secret@us-east-1?endpoint=http%3A%2F%2F127.0.0.1%3A$port
INFO
