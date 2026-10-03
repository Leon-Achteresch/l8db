begin;
create table kunde (
  id integer primary key,
  name text not null,
  ort text not null,
  erstellt_am date not null
);
insert into kunde
select n, 'k' || n, (array['Berlin', 'Hamburg', 'München', 'Köln'])[1 + n % 4], date '2026-01-01' + n
from generate_series(1, 500) as n;
create table auftrag (
  id integer primary key,
  kunde_id integer not null references kunde(id),
  betrag numeric(10, 2) not null,
  status text not null
);
insert into auftrag
select n, 1 + n % 500, (n * 7 % 1000) + 0.5, (array['offen', 'bezahlt', 'storniert'])[1 + n % 3]
from generate_series(1, 2000) as n;
create view v_auftrag as
select a.id, k.name as kunde, a.betrag, a.status from auftrag a join kunde k on k.id = a.kunde_id;
commit;
