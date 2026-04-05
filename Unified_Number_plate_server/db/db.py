import json

import psycopg2
import redis

from config import (
    ANPR_SERVER_ID,
    REDIS_DB,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_SERVER_ASSIGNMENTS_KEY,
    USE_REDIS_ASSIGNMENTS,
)


def get_connection():
    return psycopg2.connect(
        host="localhost",
        database="anpr_system",
        user="postgres",
        password="sanjay",
        port=5432
    )


def clean_path(path: str) -> str:
    if not path:
        return ""
    return path.strip().replace(" ", "%20")


def get_cameras():
    if USE_REDIS_ASSIGNMENTS:
        cameras = get_cameras_from_redis()
        if cameras is not None:
            return cameras

    return get_cameras_from_postgres()


def get_cameras_from_redis():
    try:
        client = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            decode_responses=True
        )
        key = REDIS_SERVER_ASSIGNMENTS_KEY.format(server_id=ANPR_SERVER_ID)
        payload = client.get(key)

        if not payload:
            print(f"[redis] No assignments found for {ANPR_SERVER_ID}")
            return []

        rows = json.loads(payload)
        cameras = []

        for row in rows:
            path = clean_path(row.get("video_path"))
            roi = row.get("roi")

            if not path or not roi:
                continue

            cameras.append({
                "camera_id": row["camera_id"],
                "rtsp_url": path,
                "roi": (
                    float(roi["x1"]),
                    float(roi["y1"]),
                    float(roi["x2"]),
                    float(roi["y2"])
                )
            })

        print(f"[redis] Loaded {len(cameras)} assigned cameras for {ANPR_SERVER_ID}")
        return cameras
    except Exception as exc:
        print(f"[redis] Failed to load assignments, falling back to PostgreSQL: {exc}")
        return None


def get_cameras_from_postgres():
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT c.id, c.video_path, r.x1, r.y1, r.x2, r.y2
        FROM cameras c
        JOIN rois r ON r.camera_id = c.id
    """)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    cameras = []
    for cam_id, path, x1, y1, x2, y2 in rows:
        path = clean_path(path)

        if not path:
            continue

        cameras.append({
            "camera_id": cam_id,
            "rtsp_url": path,
            "roi": (float(x1), float(y1), float(x2), float(y2))
        })

    return cameras
