import cv2
import os
from config import OUTPUT_DIR

os.makedirs(OUTPUT_DIR, exist_ok=True)


def output_thread(output_queue):
    while True:
        data = output_queue.get()

        filename = f"{OUTPUT_DIR}/{data['vehicle_number']}_{int(data['timestamp'])}.jpg"
        cv2.imwrite(filename, data["frame"])

        print("Saved:", filename)

        output_queue.task_done()
