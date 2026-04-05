import dotenv from "dotenv";
import { createClient } from "redis";
import { initDb, pool } from "../../Admin_Dashboard_server/backend/src/db.js";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const DETECTION_DEDUP_MINUTES = Number(process.env.DETECTION_DEDUP_MINUTES || 15);
const CACHE_SWEEP_INTERVAL_MS = Number(
  process.env.CACHE_SWEEP_INTERVAL_MS || 5 * 60 * 1000
);
const DB_CLEANUP_INTERVAL_MS = Number(
  process.env.DB_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000
);
const LOW_PRIORITY_DETECTION_RETENTION_DAYS = Number(
  process.env.LOW_PRIORITY_DETECTION_RETENTION_DAYS || 1
);
const CLEANUP_HOUR_IST = Number(process.env.CLEANUP_HOUR_IST || 0);
const CLEANUP_MINUTE_IST = Number(process.env.CLEANUP_MINUTE_IST || 0);
const RECENT_PLATE_KEY_PREFIX = "anpr:recent_plate:";

const redis = createClient({ url: redisUrl });

function getDelayUntilNextCleanupIst() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(now)
    .reduce((acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  let nextCleanupIst = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${String(CLEANUP_HOUR_IST).padStart(2, "0")}:${String(CLEANUP_MINUTE_IST).padStart(2, "0")}:00+05:30`
  );

  if (nextCleanupIst.getTime() <= now.getTime()) {
    nextCleanupIst = new Date(nextCleanupIst.getTime() + 24 * 60 * 60 * 1000);
  }

  return Math.max(1000, nextCleanupIst.getTime() - now.getTime());
}

async function cleanupRecentPlateCache() {
  let cursor = 0;
  let removed = 0;

  do {
    const result = await redis.scan(cursor, {
      MATCH: `${RECENT_PLATE_KEY_PREFIX}*`,
      COUNT: 100
    });
    cursor = Number(result.cursor);

    for (const key of result.keys) {
      const ttl = await redis.ttl(key);

      if (ttl === -1 || ttl > DETECTION_DEDUP_MINUTES * 60) {
        await redis.del(key);
        removed += 1;
      }
    }
  } while (cursor !== 0);

  console.log(`[cleanup] Recent-plate cache sweep complete. removed=${removed}`);
}

async function cleanupDatabase() {
  const oldDetections = await pool.query(
    `DELETE FROM plate_detections pd
     WHERE pd.detected_at < NOW() - ($1::text || ' days')::interval
       AND NOT EXISTS (
         SELECT 1
         FROM review_fines rf
         WHERE rf.plate = pd.plate
           AND rf.review_date = pd.detected_at::DATE
       )
       AND (
         SELECT COUNT(*)
         FROM plate_detections same_day
         WHERE same_day.plate = pd.plate
           AND same_day.detected_at::DATE = pd.detected_at::DATE
       ) < 3`,
    [LOW_PRIORITY_DETECTION_RETENTION_DAYS]
  );

  console.log(
    `[cleanup] Database cleanup complete. low_priority_detections_removed=${oldDetections.rowCount}, ` +
      `review_fines_preserved=true`
  );
}

async function start() {
  await initDb();
  await redis.connect();

  await cleanupRecentPlateCache();

  setInterval(() => {
    cleanupRecentPlateCache().catch((error) => {
      console.error("[cleanup] Cache sweep failed:", error);
    });
  }, CACHE_SWEEP_INTERVAL_MS);

  const scheduleDailyDatabaseCleanup = () => {
    const delay = getDelayUntilNextCleanupIst();
    console.log(
      `[cleanup] Next database cleanup scheduled in ${Math.round(delay / 1000)} seconds at ${String(CLEANUP_HOUR_IST).padStart(2, "0")}:${String(CLEANUP_MINUTE_IST).padStart(2, "0")} IST`
    );

    setTimeout(async () => {
      try {
        await cleanupDatabase();
      } catch (error) {
        console.error("[cleanup] Scheduled database cleanup failed:", error);
      } finally {
        scheduleDailyDatabaseCleanup();
      }
    }, delay);
  };

  scheduleDailyDatabaseCleanup();

  console.log("[cleanup] Cleanup service started");
}

start().catch((error) => {
  console.error("[cleanup] Startup failed:", error);
  process.exit(1);
});
