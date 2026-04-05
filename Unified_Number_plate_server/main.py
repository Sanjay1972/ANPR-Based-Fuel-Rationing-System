import json
import os
import threading
import time
from base64 import b64encode
from urllib import error, parse, request

import cv2
import Levenshtein

from config import (
    ANPR_SERVER_ID,
    APPLICATION_SERVER_URL,
    ASSIGNMENT_LONG_POLL_TIMEOUT,
    ASSIGNMENT_POLL_RETRY_INITIAL_DELAY,
    ASSIGNMENT_POLL_RETRY_MAX_DELAY,
    INDIAN_PLATE_REGEX,
    MAX_MISSED_FRAMES,
    NUMBER_PLATE_SERVER_CONNECTION_LIMIT,
    NUMBER_PLATE_SERVER_LATITUDE,
    NUMBER_PLATE_SERVER_LONGITUDE,
    OUTPUT_DIR,
    PROCESS_INTERVAL,
    SAVE_CONFIDENCE_THRESHOLD,
    SIMILARITY_THRESHOLD,
)
from db.db import get_cameras
from processor.processor import PlateProcessor
from utils.utils import normalize_video_path


def similarity(a, b):
    if not a or not b:
        return 0.0

    longest = max(len(a), len(b))
    if longest == 0:
        return 0.0

    return 1 - (Levenshtein.distance(a, b) / longest)


def create_track(plate, conf, frame, now):
    candidate = {
        "plate": plate,
        "confidence": conf,
        "frame": frame,
    }
    return {
        "candidates": [candidate],
        "last_plate": plate,
        "best_candidate": candidate,
        "missed_frames": 0,
        "created_at": now,
    }


def add_candidate(track, plate, conf, frame):
    candidate = {
        "plate": plate,
        "confidence": conf,
        "frame": frame,
    }
    track["candidates"].append(candidate)
    track["last_plate"] = plate
    track["missed_frames"] = 0

    if candidate["confidence"] >= track["best_candidate"]["confidence"]:
        track["best_candidate"] = candidate


def finalize_track(track, cam_id):
    valid_candidates = [
        candidate
        for candidate in track["candidates"]
        if len(candidate["plate"]) == 10
        and INDIAN_PLATE_REGEX.match(candidate["plate"])
        and candidate["confidence"] >= SAVE_CONFIDENCE_THRESHOLD
    ]

    if not valid_candidates:
        print(
            f"[CAM {cam_id}] No valid 10-character Indian plate with confidence "
            f">= {SAVE_CONFIDENCE_THRESHOLD:.2f} in track"
        )
        return None

    best = max(valid_candidates, key=lambda candidate: candidate["confidence"])
    plate = best["plate"]

    print(f"[CAM {cam_id}] Finalized {plate} with confidence {best['confidence']:.3f}")
    return best


def build_output_frame(frame, roi=None):
    output_frame = frame.copy()
    if roi:
        h, w = output_frame.shape[:2]
        x1, y1, x2, y2 = roi

        # Convert percentage ROI -> pixel ROI if needed
        if 0 <= x1 <= 1 and 0 <= x2 <= 1:
            x1 = int(x1 * w)
            x2 = int(x2 * w)
        if 0 <= y1 <= 1 and 0 <= y2 <= 1:
            y1 = int(y1 * h)
            y2 = int(y2 * h)

        # Draw ROI rectangle
        cv2.rectangle(output_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
        cv2.putText(
            output_frame,
            "ROI",
            (int(x1), int(y1) - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (0, 255, 0),
            2,
        )

    return output_frame


def send_detection_to_application_server(plate, frame, cam_id, roi=None):
    output_frame = build_output_frame(frame, roi)
    success, encoded = cv2.imencode(".jpg", output_frame)

    if not success:
        raise RuntimeError("Failed to encode detection frame as JPEG")

    payload = json.dumps(
        {
            "plate": plate,
            "camera_id": cam_id,
            "mimeType": "image/jpeg",
            "imageBase64": b64encode(encoded.tobytes()).decode("utf-8"),
        }
    ).encode("utf-8")

    req = request.Request(
        f"{APPLICATION_SERVER_URL}/api/detections",
        data=payload,
        headers={"Content-Type": "application/json", "Connection": "close"},
        method="POST",
    )

    with request.urlopen(req, timeout=20) as response:
        result = json.loads(response.read().decode("utf-8"))

    if result.get("ignored"):
        print(
            f"[CAM {cam_id}] Detection for {plate} ignored by application server: "
            f"{result.get('reason')} (last_detection_at={result.get('last_detection_at')})"
        )
        return

    print(
        f"[CAM {cam_id}] Detection sent for {plate}. "
        f"count_today={result.get('count_today')}, "
        f"email_sent={result.get('email_sent')}, "
        f"review_fine_created={result.get('review_fine_created')}"
    )


def close_track(tracks, cam_id, roi=None):
    track = tracks.get(cam_id)
    if track is None:
        return

    best = finalize_track(track, cam_id)
    if best:
        send_detection_to_application_server(best["plate"], best["frame"], cam_id, roi)

    del tracks[cam_id]


def process_camera(cam, processor, process_lock, stop_event):
    cam_id = cam["camera_id"]
    path = normalize_video_path(cam["rtsp_url"])
    cap = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
    last_processed_time = 0
    track = None
    frame_count = 0

    try:
        while not stop_event.is_set():
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.1)
                continue

            now = time.time()
            if now - last_processed_time < PROCESS_INTERVAL:
                time.sleep(0.05)
                continue

            last_processed_time = now
            frame_count += 1

            try:
                with process_lock:
                    plate, conf = processor.process(frame, cam["roi"])
            except Exception as exc:
                print(f"[CAM {cam_id}] Processing error: {exc}")
                continue
            print(f"\n[FRAME {frame_count} | CAM {cam_id}] Plate: {plate}, Conf: {conf:.2f}")

            if plate is None or len(plate) != 10:
                if plate is None:
                    print(f"[CAM {cam_id}] No plate detected")
                else:
                    print(f"[CAM {cam_id}] Ignoring non-10-character plate: {plate}")

                if track is not None:
                    track["missed_frames"] += 1
                    print(f"[CAM {cam_id}] Missed frames: {track['missed_frames']}")

                    if track["missed_frames"] >= MAX_MISSED_FRAMES:
                        print(f"[CAM {cam_id}] Track timed out, saving and resetting")
                        close_track({cam_id: track}, cam_id, cam["roi"])
                        track = None

                continue

            if track is None:
                print(f"[CAM {cam_id}] Starting new track")
                track = create_track(plate, conf, frame, now)
                continue

            sim = similarity(plate, track["last_plate"])
            print(f"[CAM {cam_id}] Similarity with last plate {track['last_plate']}: {sim:.2f}")

            if sim >= SIMILARITY_THRESHOLD:
                print(f"[CAM {cam_id}] Same track, adding candidate")
                add_candidate(track, plate, conf, frame)
            else:
                print(f"[CAM {cam_id}] Track break, saving current track and starting a new one")
                close_track({cam_id: track}, cam_id, cam["roi"])
                track = create_track(plate, conf, frame, now)

    finally:
        if track is not None:
            close_track({cam_id: track}, cam_id, cam["roi"])
        cap.release()


def roi_signature(roi):
    return tuple(round(float(value), 6) for value in roi)


def camera_signature(cam):
    return (cam["rtsp_url"], roi_signature(cam["roi"]))


def assignment_to_camera(assignment):
    roi = assignment.get("roi")

    if not roi:
        return None

    return {
        "camera_id": assignment["camera_id"],
        "rtsp_url": assignment["video_path"],
        "roi": (
            float(roi["x1"]),
            float(roi["y1"]),
            float(roi["x2"]),
            float(roi["y2"])
        )
    }


class CameraManager:
    def __init__(self):
        self.processor = PlateProcessor()
        self.process_lock = threading.Lock()
        self.workers = {}
        self.lock = threading.Lock()

    def apply_assignments(self, assignments):
        desired_cameras = {}

        for assignment in assignments:
            camera = assignment_to_camera(assignment)
            if camera is None:
                continue
            desired_cameras[camera["camera_id"]] = camera

        with self.lock:
            current_ids = set(self.workers.keys())
            desired_ids = set(desired_cameras.keys())

            for cam_id in current_ids - desired_ids:
                self._stop_camera(cam_id)

            for cam_id, camera in desired_cameras.items():
                worker = self.workers.get(cam_id)
                signature = camera_signature(camera)

                if worker and worker["signature"] == signature and worker["thread"].is_alive():
                    continue

                if worker:
                    self._stop_camera(cam_id)

                self._start_camera(camera, signature)

    def _start_camera(self, camera, signature):
        stop_event = threading.Event()
        thread = threading.Thread(
            target=process_camera,
            args=(
                camera,
                self.processor,
                self.process_lock,
                stop_event,
            ),
            daemon=True,
            name=f"camera-{camera['camera_id']}",
        )
        self.workers[camera["camera_id"]] = {
            "thread": thread,
            "stop_event": stop_event,
            "signature": signature,
        }
        thread.start()
        print(f"[manager] Started camera {camera['camera_id']}")

    def _stop_camera(self, cam_id):
        worker = self.workers.pop(cam_id, None)
        if worker is None:
            return

        worker["stop_event"].set()
        print(f"[manager] Stopping camera {cam_id}")

    def prune_finished_workers(self):
        with self.lock:
            finished_ids = [
                cam_id
                for cam_id, worker in self.workers.items()
                if not worker["thread"].is_alive() and worker["stop_event"].is_set()
            ]

            for cam_id in finished_ids:
                self.workers.pop(cam_id, None)

    def stop_all(self):
        with self.lock:
            for cam_id in list(self.workers.keys()):
                self._stop_camera(cam_id)


def fetch_assignment_update(last_version):
    params = {
        "since": last_version or "0",
        "timeout_ms": str(ASSIGNMENT_LONG_POLL_TIMEOUT * 1000),
    }
    url = (
        f"{APPLICATION_SERVER_URL}/api/assignments/"
        f"{parse.quote(ANPR_SERVER_ID)}/poll?{parse.urlencode(params)}"
    )

    req = request.Request(
        url,
        headers={
            "Connection": "close",
            "Cache-Control": "no-cache",
        },
    )

    with request.urlopen(req, timeout=ASSIGNMENT_LONG_POLL_TIMEOUT + 10) as response:
        return json.loads(response.read().decode("utf-8"))


def register_number_plate_server():
    payload = json.dumps(
        {
            "server_identifier": ANPR_SERVER_ID,
            "latitude": NUMBER_PLATE_SERVER_LATITUDE,
            "longitude": NUMBER_PLATE_SERVER_LONGITUDE,
            "connection_limit": NUMBER_PLATE_SERVER_CONNECTION_LIMIT,
        }
    ).encode("utf-8")
    req = request.Request(
        f"{APPLICATION_SERVER_URL}/api/servers/register",
        data=payload,
        headers={"Content-Type": "application/json", "Connection": "close"},
        method="POST",
    )

    with request.urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def assignment_poll_loop(manager):
    version = None
    retry_delay = ASSIGNMENT_POLL_RETRY_INITIAL_DELAY

    while True:
        try:
            print(f"[poll] Waiting for updates since version {version or '0'}")
            payload = fetch_assignment_update(version)
            retry_delay = ASSIGNMENT_POLL_RETRY_INITIAL_DELAY
            next_version = payload.get("version", version)
            changed = bool(payload.get("changed"))
            assignments = payload.get("assignments", [])

            print(
                f"[poll] Response received: changed={changed}, "
                f"version={next_version}, assignments={len(assignments)}"
            )
            version = next_version

            if changed:
                manager.apply_assignments(assignments)
                print(
                    f"[poll] Received {len(assignments)} assignments for {ANPR_SERVER_ID} "
                    f"at version {version}"
                )
        except error.URLError as exc:
            print(f"[poll] Long poll failed: {exc}. Retrying in {retry_delay:.1f}s")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, ASSIGNMENT_POLL_RETRY_MAX_DELAY)
        except Exception as exc:
            print(f"[poll] Unexpected polling error: {exc}. Retrying in {retry_delay:.1f}s")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, ASSIGNMENT_POLL_RETRY_MAX_DELAY)


def main():
    try:
        registration = register_number_plate_server()
        print(
            f"[register] Registered {ANPR_SERVER_ID} with "
            f"limit={NUMBER_PLATE_SERVER_CONNECTION_LIMIT}, "
            f"location=({NUMBER_PLATE_SERVER_LATITUDE}, {NUMBER_PLATE_SERVER_LONGITUDE})"
        )
        print(
            f"[register] Assignment summary: "
            f"{registration.get('assignment_summary', {})}"
        )
    except Exception as exc:
        print(f"[register] Failed to register server: {exc}")

    manager = CameraManager()
    manager.apply_assignments([
        {
            "camera_id": camera["camera_id"],
            "video_path": camera["rtsp_url"],
            "roi": {
                "x1": camera["roi"][0],
                "y1": camera["roi"][1],
                "x2": camera["roi"][2],
                "y2": camera["roi"][3],
            },
        }
        for camera in get_cameras()
    ])

    poll_thread = threading.Thread(target=assignment_poll_loop, args=(manager,), daemon=True)
    poll_thread.start()

    try:
        while True:
            manager.prune_finished_workers()
            time.sleep(1)
    except KeyboardInterrupt:
        manager.stop_all()


if __name__ == "__main__":
    main()
