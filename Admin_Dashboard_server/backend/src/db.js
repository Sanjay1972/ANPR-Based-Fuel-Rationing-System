import pg from "pg";

const { Pool } = pg;

// ✅ Direct config (no dotenv)
export const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "anpr_system",
  password: "sanjay",   // MUST be string
  port: 5432,
});

// ✅ Initialize DB
export async function initDb() {
  try {
    console.log("Connecting to PostgreSQL...");

    await pool.query("SELECT 1"); // test connection

    console.log("Connected to PostgreSQL");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bunks (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cameras (
        id SERIAL PRIMARY KEY,
        bunk_id INTEGER NOT NULL REFERENCES bunks(id) ON DELETE CASCADE,
        camera_number INTEGER NOT NULL,
        video_path TEXT NOT NULL,
        UNIQUE (bunk_id, camera_number)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rois (
        camera_id INTEGER PRIMARY KEY REFERENCES cameras(id) ON DELETE CASCADE,
        x1 DOUBLE PRECISION NOT NULL,
        y1 DOUBLE PRECISION NOT NULL,
        x2 DOUBLE PRECISION NOT NULL,
        y2 DOUBLE PRECISION NOT NULL
      );
    `);

    console.log("Tables initialized");
  } catch (err) {
    console.error("DB INIT ERROR:", err);
    throw err;
  }
}