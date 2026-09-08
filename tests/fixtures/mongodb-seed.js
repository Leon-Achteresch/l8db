const primary = db.getSiblingDB("l8db_browser_integration_long_database_name");
primary.items.deleteMany({});
primary.items.insertMany(Array.from({ length: 257 }, (_, n) => ({
  _id: n,
  n,
  status: n % 2 ? "active" : "inactive",
  nested: { value: n },
})));
const secondary = db.getSiblingDB("l8db_browser_second");
secondary.other.deleteMany({});
secondary.other.insertOne({ value: true });
