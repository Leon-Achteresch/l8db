CREATE DATABASE IF NOT EXISTS bigdata;
CREATE DATABASE IF NOT EXISTS `weird db`;
CREATE TABLE IF NOT EXISTS bigdata.events_big (
  id UInt64,
  ts DateTime64(3, 'UTC'),
  day Date MATERIALIZED toDate(ts),
  user_id UInt32,
  session UUID,
  ip IPv4,
  ip6 IPv6,
  kind LowCardinality(String),
  status Enum8('ok' = 1, 'error' = 2, 'timeout' = 3),
  amount Decimal(18, 4),
  price Float64,
  big Int128,
  huge UInt256,
  flag Bool,
  code FixedString(4),
  note Nullable(String),
  tags Array(String),
  scores Array(Float32),
  props Map(String, String),
  geo Tuple(lat Float64, lon Float64),
  nested Nested(k String, v UInt32),
  json_raw String,
  deleted UInt8 DEFAULT 0
) ENGINE = MergeTree PARTITION BY toYYYYMM(ts) ORDER BY (kind, ts, id);
INSERT INTO bigdata.events_big SELECT
  number,
  toDateTime64('2025-01-01 00:00:00', 3, 'UTC') + toIntervalSecond(number % 20000000) + toIntervalMillisecond(number % 1000),
  number % 250000,
  generateUUIDv4(),
  toIPv4(number * 2654435761 % 4294967296),
  toIPv6(concat('2001:db8::', hex(number % 65536))),
  ['click','view','purchase','signup','login','logout','search'][number % 7 + 1],
  toInt8(number % 3 + 1),
  toDecimal64(number % 100000 / 7, 4),
  number * 0.37,
  toInt128(number) * -1000000000000,
  toUInt256(number) * toUInt256(1000000000000000000000),
  number % 2 = 0,
  substring(hex(number), 1, 4),
  if(number % 5 = 0, NULL, concat('note ', toString(number))),
  arrayMap(x -> concat('tag', toString(x)), range(number % 5)),
  arrayMap(x -> toFloat32(x) / 3, range(number % 4)),
  map('browser', ['chrome','firefox','safari'][number % 3 + 1], 'os', ['mac','win','linux'][number % 3 + 1]),
  (50 + (number % 1000) / 100, 8 + (number % 700) / 100),
  ['a','b'], [toUInt32(number % 10), toUInt32(number % 20)],
  concat('{"n":', toString(number), ',"ok":true}'),
  0
FROM numbers(20000000);
CREATE TABLE IF NOT EXISTS bigdata.users_replacing (
  user_id UInt32, name String, email String, updated_at DateTime, version UInt32
) ENGINE = ReplacingMergeTree(version) ORDER BY user_id;
INSERT INTO bigdata.users_replacing SELECT number, concat('user_', toString(number)), concat('u', toString(number), '@example.com'), now() - number, 1 FROM numbers(250000);
CREATE TABLE IF NOT EXISTS bigdata.kv_memory (k String, v String) ENGINE = Memory;
INSERT INTO bigdata.kv_memory SELECT toString(number), repeat('x', number % 50) FROM numbers(1000);
CREATE TABLE IF NOT EXISTS bigdata.log_table (ts DateTime, msg String) ENGINE = Log;
INSERT INTO bigdata.log_table SELECT now() - number, concat('line ', toString(number)) FROM numbers(5000);
CREATE MATERIALIZED VIEW IF NOT EXISTS bigdata.events_by_kind ENGINE = SummingMergeTree ORDER BY (kind, day) AS SELECT kind, toDate(ts) AS day, count() AS cnt, sum(price) AS revenue FROM bigdata.events_big GROUP BY kind, day;
INSERT INTO bigdata.events_by_kind SELECT kind, toDate(ts), count(), sum(price) FROM bigdata.events_big GROUP BY kind, toDate(ts);
CREATE VIEW IF NOT EXISTS bigdata.recent_errors AS SELECT id, ts, user_id, note FROM bigdata.events_big WHERE status = 'error' ORDER BY ts DESC LIMIT 1000;
CREATE DICTIONARY IF NOT EXISTS bigdata.user_dict (user_id UInt32, name String, email String) PRIMARY KEY user_id SOURCE(CLICKHOUSE(TABLE 'users_replacing' DB 'bigdata' USER 'l8db' PASSWORD 'l8db')) LIFETIME(MIN 0 MAX 300) LAYOUT(HASHED());
CREATE TABLE IF NOT EXISTS `weird db`.`my table` (`id` UInt32, `spaced col` String, `back\`tick` String, `ümläut` Nullable(Float64)) ENGINE = MergeTree ORDER BY id;
INSERT INTO `weird db`.`my table` SELECT number, concat('v', toString(number)), 'x', if(number % 2 = 0, NULL, number / 3) FROM numbers(100);
