import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Client } = pg;

async function setupDatabase() {
  // Connect to the default 'postgres' database to create finloom
  const client = new Client({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || "5433"),
    user: process.env.PGUSER,
    database: "postgres",
  });

  await client.connect();

  const dbName = process.env.PGDATABASE || "finloom";

  // Check if database exists
  const result = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [dbName],
  );

  if (result.rows.length === 0) {
    console.log(`Creating database "${dbName}"...`);
    await client.query(`CREATE DATABASE ${dbName}`);
    console.log(`Database "${dbName}" created.`);
  } else {
    console.log(`Database "${dbName}" already exists.`);
  }

  await client.end();
}

setupDatabase().catch((err) => {
  console.error("Failed to set up database:", err);
  process.exit(1);
});
