import threading
import queue
import time

from processor.processor import PlateProcessor
from utils.utils import similarity, valid_plate
from worker.camera_threads import camera_thread
from worker.output import output_thread
from config import TIMEOUT_SECONDS, CACHE_TTL, SIMILARITY_THRESHOLD, SAVE_CONFIDENCE_THRESHOLD


def worker_main(cameras):
    frame_queue = queue.Queue(maxsize=200)
    output_queue = queue.Queue()

    processor = PlateProcessor()

    # Start camera threads
    for cam in cameras:
        threading.Thread(
            target=camera_thread,
            args=(cam, frame_queue),
            daemon=True
        ).start()

    # Start output thread
    threading.Thread(
        target=output_thread,
        args=(output_queue,),
        daemon=True
    ).start()

    tracks = {}
    cache = {}

    while True:
        now = time.time()

        if not frame_queue.empty():
            obj = frame_queue.get()

            cam_id = obj["camera_id"]
            frame = obj["frame"]
            roi = obj["roi"]

            plate, conf = processor.process(frame, roi)

            if plate is None or not valid_plate(plate):
                continue

            track = tracks.get(cam_id)

            if track is None:
                tracks[cam_id] = {
                    "candidates": [{"plate": plate, "confidence": conf}],
                    "last_seen": now,
                    "best_plate": plate
                }
                continue

            if similarity(plate, track["best_plate"]) >= SIMILARITY_THRESHOLD and conf >= SAVE_CONFIDENCE_THRESHOLD:
                track["candidates"].append({
                    "plate": plate,
                    "confidence": conf
                })
                track["last_seen"] = now

                best = max(track["candidates"], key=lambda x: x["confidence"])
                track["best_plate"] = best["plate"]

            else:
                finalize(track, cache, output_queue, frame, cam_id)
                tracks[cam_id] = {
                    "candidates": [{"plate": plate, "confidence": conf}],
                    "last_seen": now,
                    "best_plate": plate
                }

        # TIMEOUT FINALIZATION
        for cam_id, track in list(tracks.items()):
            if now - track["last_seen"] > TIMEOUT_SECONDS:
                finalize(track, cache, output_queue, None, cam_id)
                del tracks[cam_id]

        # CACHE CLEANUP
        for p in list(cache.keys()):
            if now - cache[p] > CACHE_TTL:
                del cache[p]


def finalize(track, cache, output_queue, frame, cam_id):
    if len(track["candidates"]) < 2:
        return

    best = max(track["candidates"], key=lambda x: x["confidence"])
    plate = best["plate"]

    if plate in cache:
        return

    cache[plate] = time.time()

    output_queue.put({
        "vehicle_number": plate,
        "frame": frame,
        "camera_id": cam_id,
        "timestamp": time.time()
    })

    print("Finalized:", plate)
