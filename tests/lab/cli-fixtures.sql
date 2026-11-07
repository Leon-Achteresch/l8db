CREATE TABLE IF NOT EXISTS kunde AS SELECT i AS id, 'Kunde ' || i AS name FROM generate_series(1, 500) AS i;
CREATE TABLE IF NOT EXISTS big AS SELECT i AS id, repeat('x', 128) AS payload FROM generate_series(1, 2000000) AS i;
ANALYZE kunde;
ANALYZE big;
