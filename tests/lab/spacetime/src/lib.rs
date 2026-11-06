use spacetimedb::{ReducerContext, SpacetimeType, Table};

#[derive(Clone, Debug, SpacetimeType)]
pub enum CustomerStatus {
    Active,
    Inactive,
    Pending,
}

#[spacetimedb::table(accessor = customer, public)]
pub struct Customer {
    #[primary_key]
    pub id: u64,
    pub name: String,
    pub nickname: Option<String>,
    pub credit: i128,
    pub status: CustomerStatus,
}

#[spacetimedb::table(accessor = orders, public)]
pub struct Order {
    #[primary_key]
    pub id: u64,
    pub customer_id: u64,
    pub amount_cents: i64,
    pub description: String,
}

#[spacetimedb::table(accessor = private_state)]
pub struct PrivateState {
    #[primary_key]
    pub id: u32,
    pub value: String,
}

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.private_state().insert(PrivateState {
        id: 1,
        value: "l8db-private-live-fixture".into(),
    });
}

#[spacetimedb::reducer]
pub fn seed(ctx: &ReducerContext, rows: u32) -> Result<(), String> {
    if rows > 20_000 {
        return Err("Fixture is limited to 20000 rows".into());
    }
    if ctx.db.customer().count() != 0 {
        return Ok(());
    }
    for index in 1..=rows {
        let id = index as u64;
        ctx.db.customer().insert(Customer {
            id,
            name: format!("Kunde {index:05}"),
            nickname: (index % 3 == 0).then(|| format!("Nick {index}")),
            credit: 100_000_000_000_000_000_000i128 + i128::from(index),
            status: match index % 3 {
                0 => CustomerStatus::Active,
                1 => CustomerStatus::Inactive,
                _ => CustomerStatus::Pending,
            },
        });
        ctx.db.orders().insert(Order {
            id,
            customer_id: id,
            amount_cents: 1999 + i64::from(index),
            description: format!("Bestellung {index:05} {}", "x".repeat(128)),
        });
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn rename_customer(ctx: &ReducerContext, id: u64, name: String) -> Result<(), String> {
    if name.len() > 120 {
        return Err("Name is limited to 120 bytes".into());
    }
    let mut customer = ctx
        .db
        .customer()
        .id()
        .find(id)
        .ok_or("Customer not found")?;
    customer.name = name;
    ctx.db.customer().id().update(customer);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_large_order_payload(ctx: &ReducerContext, id: u64, bytes: u32) -> Result<(), String> {
    if bytes > 17 * 1024 * 1024 {
        return Err("Fixture payload exceeds 17 MiB".into());
    }
    let mut order = ctx.db.orders().id().find(id).ok_or("Order not found")?;
    order.description = "x".repeat(bytes as usize);
    ctx.db.orders().id().update(order);
    Ok(())
}
