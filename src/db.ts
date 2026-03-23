import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || "5433"),
  user: process.env.PGUSER,
  database: process.env.PGDATABASE,
});

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}

export async function logEvent(
  eventType: string,
  entityType: string,
  entityId: number,
  data: Record<string, unknown>,
) {
  await query(
    `INSERT INTO stock_events (event_type, entity_type, entity_id, data)
     VALUES ($1, $2, $3, $4)`,
    [eventType, entityType, entityId, JSON.stringify(data)],
  );
}
