import psycopg2


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