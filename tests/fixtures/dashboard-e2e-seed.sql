begin;
create table customers (
  id integer primary key,
  name text not null,
  country text not null
);
insert into customers
select n, 'Kunde ' || n, (array['DE', 'AT', 'CH', 'FR', 'US'])[1 + n % 5]
from generate_series(1, 40) as n;
create table orders (
  id integer primary key,
  customer_id integer not null references customers(id),
  amount numeric(10, 2) not null,
  sessions integer not null,
  plan text not null,
  channel text not null,
  score integer not null,
  max_score integer not null,
  created_at timestamptz not null
);
insert into orders
select n,
  1 + n % 40,
  (n * 37 % 1900) + 10.5,
  1 + n % 12,
  (array['Free', 'Pro', 'Team', 'Enterprise'])[1 + n % 4],
  (array['Web', 'Partner', 'Sales'])[1 + n % 3],
  n % 80,
  100,
  date_trunc('day', now()) - make_interval(days => n % 360)
from generate_series(1, 800) as n;
create view v_orders as
select o.id, o.created_at, o.amount, o.plan, o.channel, c.country
from orders o join customers c on c.id = o.customer_id;
commit;
