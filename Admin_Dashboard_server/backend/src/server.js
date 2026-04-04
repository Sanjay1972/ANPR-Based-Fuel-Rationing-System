import express from "express";
import cors from "cors";
import { initDb, pool } from "./db.js";
import { extractFrame } from "./frame.js";

const app = express();
const port = 4000;

// ✅ Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ----------------------
// Health check
// ----------------------
app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ----------------------
// BUNKS
// ----------------------
app.get("/api/bunks", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, address FROM bunks ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/bunks", async (req, res, next) => {
  const { name, address } = req.body ?? {};

  if (!name?.trim() || !address?.trim()) {
    return res.status(400).json({ error: "Name and address required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO bunks (name, address)
       VALUES ($1, $2)
       RETURNING id, name, address`,
      [name.trim(), address.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// ----------------------
// CAMERAS
// ----------------------
app.get("/api/cameras/:bunkId", async (req, res, next) => {
  const bunkId = Number(req.params.bunkId);

  if (!Number.isInteger(bunkId)) {
    return res.status(400).json({ error: "Invalid bunk id" });
  }

  try {
    const result = await pool.query(
      `SELECT c.id, c.bunk_id, c.camera_number, c.video_path,
        CASE WHEN r.camera_id IS NULL THEN NULL
        ELSE json_build_object('x1', r.x1, 'y1', r.y1, 'x2', r.x2, 'y2', r.y2)
        END AS roi
       FROM cameras c
       LEFT JOIN rois r ON r.camera_id = c.id
       WHERE c.bunk_id = $1
       ORDER BY c.camera_number ASC`,
      [bunkId]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/cameras", async (req, res, next) => {
  const bunkId = Number(req.body?.bunk_id);
  const videoPath = req.body?.video_path;

  if (!Number.isInteger(bunkId) || !videoPath?.trim()) {
    return res.status(400).json({ error: "bunk_id and video_path required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const nextNumber = await client.query(
      `SELECT COALESCE(MAX(camera_number), 0) + 1 AS num
       FROM cameras WHERE bunk_id = $1`,
      [bunkId]
    );

    const cameraNumber = nextNumber.rows[0].num;

    const insert = await client.query(
      `INSERT INTO cameras (bunk_id, camera_number, video_path)
       VALUES ($1, $2, $3)
       RETURNING id, bunk_id, camera_number, video_path`,
      [bunkId, cameraNumber, videoPath.trim()]
    );

    await client.query("COMMIT");

    res.status(201).json({ ...insert.rows[0], roi: null });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// ----------------------
// ROI
// ----------------------
app.post("/api/roi", async (req, res, next) => {
  const cameraId = Number(req.body?.camera_id);
  const roi = req.body?.roi;

  if (
    !Number.isInteger(cameraId) ||
    !roi ||
    [roi.x1, roi.y1, roi.x2, roi.y2].some((v) => typeof v !== "number")
  ) {
    return res.status(400).json({ error: "Invalid ROI" });
  }

  const x1 = Math.max(0, Math.min(1, Math.min(roi.x1, roi.x2)));
  const y1 = Math.max(0, Math.min(1, Math.min(roi.y1, roi.y2)));
  const x2 = Math.max(0, Math.min(1, Math.max(roi.x1, roi.x2)));
  const y2 = Math.max(0, Math.min(1, Math.max(roi.y1, roi.y2)));

  try {
    const result = await pool.query(
      `INSERT INTO rois (camera_id, x1, y1, x2, y2)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (camera_id)
       DO UPDATE SET x1=$2, y1=$3, x2=$4, y2=$5
       RETURNING *`,
      [cameraId, x1, y1, x2, y2]
    );

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// ----------------------
// FRAME EXTRACTION
// ----------------------
app.get("/api/frame/:cameraId", async (req, res, next) => {
  const cameraId = Number(req.params.cameraId);

  if (!Number.isInteger(cameraId)) {
    return res.status(400).json({ error: "Invalid camera id" });
  }

  try {
    const result = await pool.query(
      "SELECT video_path FROM cameras WHERE id = $1",
      [cameraId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Camera not found" });
    }

    const frame = await extractFrame(result.rows[0].video_path);

    res.json({
      camera_id: cameraId,
      imageBase64: frame.imageBase64,
      mimeType: frame.mimeType
    });
  } catch (error) {
    next(error);
  }
});

// ----------------------
// ERROR HANDLER
// ----------------------
app.use((err, _req, res, _next) => {
  console.error("ERROR:", err);
  res.status(500).json({ error: err.message });
});

// ----------------------
// START SERVER
// ----------------------
async function start() {
  try {
    await initDb();

    app.listen(port, () => {
      console.log(`🚀 Server running at http://localhost:${port}`);
    });
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
}

start();