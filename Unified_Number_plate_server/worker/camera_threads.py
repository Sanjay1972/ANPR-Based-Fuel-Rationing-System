import cv2
import time
from config import PROCESS_INTERVAL


def camera_thread(cam, frame_queue):
    cap = cv2.VideoCapture(cam["rtsp_url"])

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(1)
            continue

        obj = {
            "camera_id": cam["camera_id"],
            "frame": frame,
            "roi": cam["roi"],
            "timestamp": time.time()
        }

        if not frame_queue.full():
            frame_queue.put(obj)

        time.sleep(PROCESS_INTERVAL)
