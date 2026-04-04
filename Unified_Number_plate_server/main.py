import os
import time
import threading

import cv2
import Levenshtein

from config import (
    CACHE_TTL,
    INDIAN_PLATE_REGEX,
    MAX_MISSED_FRAMES,
    OUTPUT_DIR,
    PROCESS_INTERVAL,
    SAVE_CONFIDENCE_THRESHOLD,
    SIMILARITY_THRESHOLD,
)
from db.db import get_cameras
from processor.processor import PlateProcessor
from utils.utils import normalize_video_path


os.makedirs(OUTPUT_DIR, exist_ok=True)


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


def finalize_track(track, cache, cam_id):
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

    if plate in cache:
        print(f"[CAM {cam_id}] Plate {plate} already saved recently")
        return None

    cache[plate] = time.time()
    print(f"[CAM {cam_id}] Finalized {plate} with confidence {best['confidence']:.3f}")
    return best


def save_output(plate, frame, cam_id, roi=None):
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

    filename = os.path.join(OUTPUT_DIR, f"{plate}_{int(time.time())}_roi.jpg")
    cv2.imwrite(filename, output_frame)
    print(f"[CAM {cam_id}] Saved {filename}")


def close_track(tracks, cam_id, cache, roi=None):
    track = tracks.get(cam_id)
    if track is None:
        return

    best = finalize_track(track, cache, cam_id)
    if best:
        save_output(best["plate"], best["frame"], cam_id, roi)

    del tracks[cam_id]


def process_camera(cam, processor, process_lock, cache, cache_lock):
    cam_id = cam["camera_id"]
    path = normalize_video_path(cam["rtsp_url"])
    cap = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
    last_processed_time = 0
    track = None
    frame_count = 0

    try:
        while True:
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
                        with cache_lock:
                            close_track({cam_id: track}, cam_id, cache, cam["roi"])
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
                with cache_lock:
                    close_track({cam_id: track}, cam_id, cache, cam["roi"])
                track = create_track(plate, conf, frame, now)

    finally:
        cap.release()


def main():
    cameras = get_cameras()

    processor = PlateProcessor()
    process_lock = threading.Lock()
    cache = {}
    cache_lock = threading.Lock()

    threads = []
    for cam in cameras:
        thread = threading.Thread(
            target=process_camera,
            args=(cam, processor, process_lock, cache, cache_lock),
            daemon=True,
        )
        thread.start()
        threads.append(thread)

    try:
        while True:
            now = time.time()
            with cache_lock:
                for plate_key in list(cache.keys()):
                    if now - cache[plate_key] > CACHE_TTL:
                        del cache[plate_key]
            time.sleep(1)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
