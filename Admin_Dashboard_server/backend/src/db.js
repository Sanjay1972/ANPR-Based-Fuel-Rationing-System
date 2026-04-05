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
        address TEXT NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION
      );
    `);

    await pool.query(`
      ALTER TABLE bunks
      ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    `);

    await pool.query(`
      ALTER TABLE bunks
      ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS number_plate_servers (
        id SERIAL PRIMARY KEY,
        server_identifier TEXT NOT NULL UNIQUE,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        connection_limit INTEGER NOT NULL CHECK (connection_limit > 0)
      );
    `);

    await pool.query(`
      INSERT INTO number_plate_servers (server_identifier, latitude, longitude, connection_limit)
      VALUES ('server-1', 13.082700, 80.270700, 3)
      ON CONFLICT (server_identifier) DO NOTHING;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS plate_detections (
        id SERIAL PRIMARY KEY,
        plate TEXT NOT NULL,
        camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        image_base64 TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'image/jpeg'
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS review_fines (
        id SERIAL PRIMARY KEY,
        plate TEXT NOT NULL,
        review_date DATE NOT NULL,
        latest_detection_id INTEGER REFERENCES plate_detections(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        review_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        email_sent_at TIMESTAMPTZ,
        UNIQUE (plate, review_date)
      );
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION notify_assignment_change()
      RETURNS trigger AS $$
      DECLARE
        payload JSON;
        entity_id INTEGER;
        current_row JSONB;
      BEGIN
        current_row := to_jsonb(COALESCE(NEW, OLD));

        entity_id := CASE
          WHEN TG_TABLE_NAME = 'rois' THEN NULLIF(current_row ->> 'camera_id', '')::INTEGER
          ELSE NULLIF(current_row ->> 'id', '')::INTEGER
        END;

        payload := json_build_object(
          'table', TG_TABLE_NAME,
          'operation', TG_OP,
          'id', entity_id,
          'at', NOW()
        );

        PERFORM pg_notify('assignment_events', payload::text);
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS assignment_change_on_bunks ON bunks;
      CREATE TRIGGER assignment_change_on_bunks
      AFTER INSERT OR UPDATE OR DELETE ON bunks
      FOR EACH ROW
      EXECUTE FUNCTION notify_assignment_change();
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS assignment_change_on_cameras ON cameras;
      CREATE TRIGGER assignment_change_on_cameras
      AFTER INSERT OR UPDATE OR DELETE ON cameras
      FOR EACH ROW
      EXECUTE FUNCTION notify_assignment_change();
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS assignment_change_on_rois ON rois;
      CREATE TRIGGER assignment_change_on_rois
      AFTER INSERT OR UPDATE OR DELETE ON rois
      FOR EACH ROW
      EXECUTE FUNCTION notify_assignment_change();
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS assignment_change_on_number_plate_servers ON number_plate_servers;
      CREATE TRIGGER assignment_change_on_number_plate_servers
      AFTER INSERT OR UPDATE OR DELETE ON number_plate_servers
      FOR EACH ROW
      EXECUTE FUNCTION notify_assignment_change();
    `);

    console.log("Tables initialized");
  } catch (err) {
    console.error("DB INIT ERROR:", err);
    throw err;
  }
}
