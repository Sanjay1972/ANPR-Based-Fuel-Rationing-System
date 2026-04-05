import http from "http";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { createClient } from "redis";
import { initDb, pool } from "../../Admin_Dashboard_server/backend/src/db.js";

dotenv.config();

const port = Number(process.env.PORT || 4100);
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const ASSIGNMENT_CHANNEL = "assignment_events";
const CAMERA_ASSIGNMENTS_KEY = "anpr:camera_assignments";
const SERVERS_KEY = "anpr:number_plate_servers";
const UNASSIGNED_CAMERAS_KEY = "anpr:unassigned_cameras";
const META_KEY = "anpr:assignment_meta";
const CACHE_UPDATE_CHANNEL = "anpr:assignments:updated";
const LONG_POLL_TIMEOUT_MS = Number(process.env.LONG_POLL_TIMEOUT_MS || 25000);
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || "71762205104@cit.edu.in";
const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";
const DETECTION_DEDUP_MINUTES = Number(process.env.DETECTION_DEDUP_MINUTES || 15);

const redis = createClient({ url: redisUrl });
const mailTransport =
  EMAIL_USER && EMAIL_PASS
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: EMAIL_USER,
          pass: EMAIL_PASS
        }
      })
    : null;

let lastSyncSummary = null;
let syncInFlight = null;
let syncQueued = false;
const assignmentWaiters = new Map();

function haversineDistanceKm(from, to) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function hasValidCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

function getServerAssignmentsKey(serverIdentifier) {
  return `anpr:server_assignments:${serverIdentifier}`;
}

function getServerAssignmentsVersionKey(serverIdentifier) {
  return `anpr:server_assignments_version:${serverIdentifier}`;
}

function getWaiters(serverIdentifier) {
  if (!assignmentWaiters.has(serverIdentifier)) {
    assignmentWaiters.set(serverIdentifier, new Set());
  }

  return assignmentWaiters.get(serverIdentifier);
}

function notifyAssignmentWaiters(serverIdentifier, payload) {
  const waiters = assignmentWaiters.get(serverIdentifier);

  if (!waiters || waiters.size === 0) {
    return;
  }

  for (const resolve of waiters) {
    resolve(payload);
  }

  waiters.clear();
}

async function parseJsonBody(req) {
  const body = await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });

  return body ? JSON.parse(body) : {};
}

async function sendMail({ subject, text, html }) {
  if (!mailTransport) {
    console.warn("[mail] EMAIL_USER / EMAIL_PASS not configured, skipping email send");
    return { skipped: true };
  }

  await mailTransport.sendMail({
    from: EMAIL_USER,
    to: NOTIFICATION_EMAIL,
    subject,
    text,
    html
  });

  return { skipped: false };
}

async function fetchNumberPlateServers() {
  const result = await pool.query(
    `SELECT id, server_identifier, latitude, longitude, connection_limit
     FROM number_plate_servers
     ORDER BY id ASC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    server_identifier: row.server_identifier,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    connection_limit: Number(row.connection_limit)
  }));
}

async function fetchAssignableCameras() {
  const result = await pool.query(
    `SELECT
       c.id AS camera_id,
       c.bunk_id,
       c.camera_number,
       c.video_path,
       b.name AS bunk_name,
       b.address AS bunk_address,
       b.latitude,
       b.longitude,
       r.x1,
       r.y1,
       r.x2,
       r.y2
     FROM cameras c
     JOIN bunks b ON b.id = c.bunk_id
     JOIN rois r ON r.camera_id = c.id
     ORDER BY c.id ASC`
  );

  return result.rows.map((row) => ({
    camera_id: row.camera_id,
    bunk_id: row.bunk_id,
    camera_number: row.camera_number,
    video_path: row.video_path,
    bunk_name: row.bunk_name,
    bunk_address: row.bunk_address,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    roi:
      row.x1 === null
        ? null
        : {
            x1: Number(row.x1),
            y1: Number(row.y1),
            x2: Number(row.x2),
            y2: Number(row.y2)
          }
  }));
}

async function fetchCurrentAssignments() {
  const currentAssignments = await redis.hGetAll(CAMERA_ASSIGNMENTS_KEY);

  return new Map(
    Object.values(currentAssignments)
      .map((value) => JSON.parse(value))
      .map((assignment) => [assignment.camera_id, assignment])
  );
}

async function fetchReviewFines() {
  const result = await pool.query(
    `SELECT
       rf.id,
       rf.plate,
       rf.review_date,
       rf.status,
       rf.review_note,
       rf.created_at,
       rf.reviewed_at,
       rf.email_sent_at,
       COALESCE(
         json_agg(
           json_build_object(
             'id', pd.id,
             'camera_id', pd.camera_id,
             'detected_at', pd.detected_at,
             'image_base64', pd.image_base64,
             'mime_type', pd.mime_type
           )
           ORDER BY pd.detected_at ASC
         ) FILTER (WHERE pd.id IS NOT NULL),
         '[]'::json
       ) AS detections
     FROM review_fines rf
     LEFT JOIN plate_detections pd
       ON pd.plate = rf.plate
      AND pd.detected_at::DATE = rf.review_date
     GROUP BY
       rf.id,
       rf.plate,
       rf.review_date,
       rf.status,
       rf.review_note,
       rf.created_at,
       rf.reviewed_at,
       rf.email_sent_at
     ORDER BY rf.created_at DESC`
  );

  return result.rows;
}

function assignCamerasToServers(cameras, servers, currentAssignments) {
  const remainingCapacity = new Map(
    servers.map((server) => [server.server_identifier, server.connection_limit])
  );
  const serversByIdentifier = new Map(
    servers.map((server) => [server.server_identifier, server])
  );
  const camerasById = new Map(cameras.map((camera) => [camera.camera_id, camera]));
  const assignments = [];
  const unassigned = [];
  const pendingCameras = [];

  for (const camera of cameras) {
    if (!hasValidCoordinates(camera.latitude, camera.longitude)) {
      unassigned.push({
        ...camera,
        assignment_status: "missing_bunk_coordinates"
      });
      continue;
    }

    const existingAssignment = currentAssignments.get(camera.camera_id);
    const existingServer = existingAssignment
      ? serversByIdentifier.get(existingAssignment.assigned_server_identifier)
      : null;

    if (
      existingAssignment &&
      existingServer &&
      (remainingCapacity.get(existingServer.server_identifier) || 0) > 0
    ) {
      remainingCapacity.set(
        existingServer.server_identifier,
        (remainingCapacity.get(existingServer.server_identifier) || 0) - 1
      );
      assignments.push({
        ...camera,
        assignment_status: "assigned",
        assigned_server_id: existingServer.id,
        assigned_server_identifier: existingServer.server_identifier,
        assigned_server_location: {
          latitude: existingServer.latitude,
          longitude: existingServer.longitude
        },
        distance_km: Number(haversineDistanceKm(camera, existingServer).toFixed(3))
      });
      continue;
    }

    pendingCameras.push(camera);
  }

  for (const camera of pendingCameras) {
    const rankedServers = servers
      .map((server) => ({
        ...server,
        distance_km: haversineDistanceKm(camera, server)
      }))
      .sort((left, right) => left.distance_km - right.distance_km || left.id - right.id);

    const selectedServer = rankedServers.find(
      (server) => (remainingCapacity.get(server.server_identifier) || 0) > 0
    );

    if (!selectedServer) {
      unassigned.push({
        ...camera,
        assignment_status: "no_capacity_available"
      });
      continue;
    }

    remainingCapacity.set(
      selectedServer.server_identifier,
      (remainingCapacity.get(selectedServer.server_identifier) || 0) - 1
    );

    assignments.push({
      ...camera,
      assignment_status: "assigned",
      assigned_server_id: selectedServer.id,
      assigned_server_identifier: selectedServer.server_identifier,
      assigned_server_location: {
        latitude: selectedServer.latitude,
        longitude: selectedServer.longitude
      },
      distance_km: Number(selectedServer.distance_km.toFixed(3))
    });
  }

  return { assignments, unassigned };
}

async function writeAssignmentsToRedis(servers, assignments, unassigned) {
  const multi = redis.multi();
  const serverAssignmentKeys = servers.map((server) =>
    getServerAssignmentsKey(server.server_identifier)
  );
  const changedServers = [];

  if (serverAssignmentKeys.length > 0) {
    multi.del(serverAssignmentKeys);
  }

  multi.del(CAMERA_ASSIGNMENTS_KEY);
  multi.set(SERVERS_KEY, JSON.stringify(servers));
  multi.set(UNASSIGNED_CAMERAS_KEY, JSON.stringify(unassigned));

  if (assignments.length > 0) {
    multi.hSet(
      CAMERA_ASSIGNMENTS_KEY,
      Object.fromEntries(
        assignments.map((assignment) => [String(assignment.camera_id), JSON.stringify(assignment)])
      )
    );
  }

  for (const server of servers) {
    const serverAssignments = assignments.filter(
      (assignment) => assignment.assigned_server_identifier === server.server_identifier
    );
    const assignmentPayload = JSON.stringify(serverAssignments);
    const assignmentKey = getServerAssignmentsKey(server.server_identifier);
    const versionKey = getServerAssignmentsVersionKey(server.server_identifier);
    const previousPayload = await redis.get(assignmentKey);

    multi.set(
      assignmentKey,
      assignmentPayload
    );

    if (previousPayload !== assignmentPayload) {
      const nextVersion = String(Date.now());
      multi.set(versionKey, nextVersion);
      changedServers.push({
        server_identifier: server.server_identifier,
        version: nextVersion,
        assignments: serverAssignments,
        changed: true
      });
    }
  }

  const summary = {
    updated_at: new Date().toISOString(),
    total_servers: servers.length,
    total_assigned_cameras: assignments.length,
    total_unassigned_cameras: unassigned.length
  };

  multi.set(META_KEY, JSON.stringify(summary));
  multi.publish(CACHE_UPDATE_CHANNEL, JSON.stringify(summary));
  await multi.exec();

  for (const changedServer of changedServers) {
    notifyAssignmentWaiters(changedServer.server_identifier, changedServer);
  }

  return { summary, changedServers };
}

async function syncAssignments(reason = "manual") {
  if (syncInFlight) {
    syncQueued = true;
    return syncInFlight;
  }

  syncInFlight = (async () => {
    try {
      const [servers, cameras, currentAssignments] = await Promise.all([
        fetchNumberPlateServers(),
        fetchAssignableCameras(),
        fetchCurrentAssignments()
      ]);
      const { assignments, unassigned } = assignCamerasToServers(
        cameras,
        servers,
        currentAssignments
      );
      const { summary } = await writeAssignmentsToRedis(servers, assignments, unassigned);
      lastSyncSummary = { ...summary, reason };
      console.log(
        `[assignment-sync] ${reason}: assigned=${assignments.length}, unassigned=${unassigned.length}`
      );
      return lastSyncSummary;
    } finally {
      syncInFlight = null;
      if (syncQueued) {
        syncQueued = false;
        setTimeout(() => {
          syncAssignments("queued-change").catch((error) => {
            console.error("[assignment-sync] queued sync failed:", error);
          });
        }, 0);
      }
    }
  })();

  return syncInFlight;
}

async function createListenerConnection() {
  const client = await pool.connect();
  await client.query(`LISTEN ${ASSIGNMENT_CHANNEL}`);
  client.on("notification", (message) => {
    console.log("[assignment-events] notification received:", message.payload);
    syncAssignments("db-notify").catch((error) => {
      console.error("[assignment-sync] db notification sync failed:", error);
    });
  });
  client.on("error", (error) => {
    console.error("[assignment-events] listener error:", error);
  });
  return client;
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/detections") {
    const payload = await parseJsonBody(req);
    const plate = String(payload.plate || "").trim().toUpperCase();
    const cameraId = Number(payload.camera_id);
    const imageBase64 = String(payload.imageBase64 || "").trim();
    const mimeType = String(payload.mimeType || "image/jpeg").trim();

    if (!plate || !Number.isInteger(cameraId) || !imageBase64) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "plate, camera_id, and imageBase64 are required" }));
      return;
    }

    const duplicateCheck = await pool.query(
      `SELECT id, camera_id, detected_at
       FROM plate_detections
       WHERE plate = $1
         AND detected_at >= NOW() - ($2::text || ' minutes')::interval
       ORDER BY detected_at DESC
       LIMIT 1`,
      [plate, DETECTION_DEDUP_MINUTES]
    );

    if (duplicateCheck.rowCount > 0) {
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      res.end(
        JSON.stringify({
          ok: true,
          ignored: true,
          reason: "seen_within_last_15_minutes",
          last_detection_at: duplicateCheck.rows[0].detected_at
        })
      );
      return;
    }

    const insert = await pool.query(
      `INSERT INTO plate_detections (plate, camera_id, image_base64, mime_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, detected_at`,
      [plate, cameraId, imageBase64, mimeType]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM plate_detections
       WHERE plate = $1
         AND detected_at::DATE = CURRENT_DATE`,
      [plate]
    );

    const countToday = countResult.rows[0].count;
    let emailSent = false;
    let reviewFineCreated = false;

    if (countToday === 2) {
      await sendMail({
        subject: `Vehicle ${plate} seen twice today`,
        text: `Vehicle ${plate} was detected twice today in the ANPR system.`,
        html: `<p>Vehicle <strong>${plate}</strong> was detected twice today in the ANPR system.</p>`
      });
      emailSent = true;
    }

    if (countToday >= 3) {
      await pool.query(
        `INSERT INTO review_fines (plate, review_date, latest_detection_id, status)
         VALUES ($1, CURRENT_DATE, $2, 'pending')
         ON CONFLICT (plate, review_date)
         DO UPDATE SET latest_detection_id = EXCLUDED.latest_detection_id
         WHERE review_fines.status = 'pending'`,
        [plate, insert.rows[0].id]
      );
      reviewFineCreated = true;
    }

    res.writeHead(201, { "Content-Type": "application/json", ...corsHeaders });
    res.end(
      JSON.stringify({
        ok: true,
        ignored: false,
        detection_id: insert.rows[0].id,
        count_today: countToday,
        email_sent: emailSent,
        review_fine_created: reviewFineCreated
      })
    );
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/servers/register") {
    const payload = await parseJsonBody(req);
    const serverIdentifier = String(payload.server_identifier || "").trim();
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const connectionLimit = Number(payload.connection_limit);

    if (
      !serverIdentifier ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isInteger(connectionLimit) ||
      connectionLimit < 1
    ) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Invalid server registration payload" }));
      return;
    }

    const result = await pool.query(
      `INSERT INTO number_plate_servers (
         server_identifier, latitude, longitude, connection_limit
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (server_identifier)
       DO UPDATE SET
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         connection_limit = EXCLUDED.connection_limit
       RETURNING id, server_identifier, latitude, longitude, connection_limit`,
      [serverIdentifier, latitude, longitude, connectionLimit]
    );

    const summary = await syncAssignments("server-register");

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(
      JSON.stringify({
        server: result.rows[0],
        assignment_summary: summary
      })
    );
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    const meta = await redis.get(META_KEY);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(
      JSON.stringify({
        ok: true,
        redis_connected: redis.isOpen,
        last_sync: meta ? JSON.parse(meta) : lastSyncSummary
      })
    );
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/sync") {
    const summary = await syncAssignments("api-sync");
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(summary));
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/assignments") {
    const [summary, servers, unassigned, cameraAssignments] = await Promise.all([
      redis.get(META_KEY),
      redis.get(SERVERS_KEY),
      redis.get(UNASSIGNED_CAMERAS_KEY),
      redis.hGetAll(CAMERA_ASSIGNMENTS_KEY)
    ]);

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(
      JSON.stringify({
        summary: summary ? JSON.parse(summary) : null,
        servers: servers ? JSON.parse(servers) : [],
        unassigned: unassigned ? JSON.parse(unassigned) : [],
        assignments: Object.values(cameraAssignments).map((value) => JSON.parse(value))
      })
    );
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/review-fines") {
    const reviewFines = await fetchReviewFines();
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(reviewFines));
    return;
  }

  if (
    req.method === "POST" &&
    /^\/api\/review-fines\/\d+\/(approve|reject)$/.test(requestUrl.pathname)
  ) {
    const [, , , reviewFineId, action] = requestUrl.pathname.split("/");
    const reviewFine = await pool.query(
      `SELECT rf.id, rf.plate
       FROM review_fines rf
       WHERE rf.id = $1`,
      [Number(reviewFineId)]
    );

    if (reviewFine.rowCount === 0) {
      res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Review fine not found" }));
      return;
    }

    const notePayload = await parseJsonBody(req);
    const reviewNote = String(notePayload.note || "").trim();

    if (action === "approve") {
      await sendMail({
        subject: `Fine initiated for vehicle ${reviewFine.rows[0].plate}`,
        text: `A fine review was approved for vehicle ${reviewFine.rows[0].plate}.`,
        html: `<p>A fine review was approved for vehicle <strong>${reviewFine.rows[0].plate}</strong>.</p>`
      });

      await pool.query(
        `UPDATE review_fines
         SET status = 'approved',
             review_note = $2,
             reviewed_at = NOW(),
             email_sent_at = NOW()
         WHERE id = $1`,
        [Number(reviewFineId), reviewNote || "Fine initiated by admin"]
      );
    } else {
      await pool.query(
        `UPDATE review_fines
         SET status = 'rejected',
             review_note = $2,
             reviewed_at = NOW()
         WHERE id = $1`,
        [Number(reviewFineId), reviewNote || "Rejected by admin"]
      );
    }

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && requestUrl.pathname.startsWith("/api/assignments/")) {
    const serverIdentifier = decodeURIComponent(
      requestUrl.pathname.replace("/api/assignments/", "")
    );
    const isLongPoll = requestUrl.pathname.endsWith("/poll");

    if (isLongPoll) {
      const normalizedServerIdentifier = serverIdentifier.replace(/\/poll$/, "");
      const since = requestUrl.searchParams.get("since") || "0";
      const timeoutMs = Math.min(
        Number(requestUrl.searchParams.get("timeout_ms") || LONG_POLL_TIMEOUT_MS),
        LONG_POLL_TIMEOUT_MS
      );
      const versionKey = getServerAssignmentsVersionKey(normalizedServerIdentifier);
      const assignmentsKey = getServerAssignmentsKey(normalizedServerIdentifier);
      const currentVersion = (await redis.get(versionKey)) || "0";
      const currentAssignments = JSON.parse((await redis.get(assignmentsKey)) || "[]");

      if (since !== currentVersion) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            server_identifier: normalizedServerIdentifier,
            version: currentVersion,
            assignments: currentAssignments,
            changed: true
          })
        );
        return;
      }

      const payload = await new Promise((resolve) => {
        const waiters = getWaiters(normalizedServerIdentifier);
        const timeoutHandle = setTimeout(() => {
          waiters.delete(resolveFromWaiter);
          resolve(null);
        }, timeoutMs);

        function resolveFromWaiter(nextPayload) {
          clearTimeout(timeoutHandle);
          waiters.delete(resolveFromWaiter);
          resolve(nextPayload);
        }

        waiters.add(resolveFromWaiter);
      });

      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      res.end(
        JSON.stringify(
          payload || {
            server_identifier: normalizedServerIdentifier,
            version: currentVersion,
            assignments: currentAssignments,
            changed: false
          }
        )
      );
      return;
    }

    const assignments = await redis.get(getServerAssignmentsKey(serverIdentifier));

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(
      JSON.stringify({
        server_identifier: serverIdentifier,
        assignments: assignments ? JSON.parse(assignments) : []
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify({ error: "Not found" }));
}

async function start() {
  await initDb();
  await redis.connect();
  await syncAssignments("startup");
  await createListenerConnection();

  setInterval(() => {
    syncAssignments("interval-fallback").catch((error) => {
      console.error("[assignment-sync] interval sync failed:", error);
    });
  }, 30000);

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("[application-server] request failed:", error);
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end(JSON.stringify({ error: error.message }));
    });
  });

  server.listen(port, () => {
    console.log(`Application server listening at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Application server startup failed:", error);
  process.exit(1);
});
