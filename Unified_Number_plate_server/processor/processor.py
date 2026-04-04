import cv2
import numpy as np
from ultralytics import YOLO

from config import ROI_MIN_OVERLAP_RATIO, YOLO_MODEL_PATH
from processor.ocr_service import OCRService


class PlateProcessor:
    def __init__(self):
        print("Loading YOLO...")
        self.model = YOLO(YOLO_MODEL_PATH)

        print("Loading OCR...")
        self.ocr = OCRService()
        self.ocr.warmup()

    # -----------------------------
    # DETECTION
    # -----------------------------
    def detect_plate(self, frame, roi_bounds=None):
        if frame is None or frame.size == 0:
            return None

        results = self.model(frame, verbose=False)

        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return None

        h, w = frame.shape[:2]

        if roi_bounds is None:
            roi_x1, roi_y1, roi_x2, roi_y2 = 0, 0, w, h
        else:
            roi_x1, roi_y1, roi_x2, roi_y2 = roi_bounds

        best = None
        best_conf = -1.0

        for box in boxes:
            conf = float(box.conf[0])
            x1, y1, x2, y2 = map(int, box.xyxy[0])

            x1 = max(0, min(w, x1))
            y1 = max(0, min(h, y1))
            x2 = max(0, min(w, x2))
            y2 = max(0, min(h, y2))

            box_w = x2 - x1
            box_h = y2 - y1
            if box_w <= 0 or box_h <= 0:
                continue

            inter_x1 = max(x1, roi_x1)
            inter_y1 = max(y1, roi_y1)
            inter_x2 = min(x2, roi_x2)
            inter_y2 = min(y2, roi_y2)

            inter_w = max(0, inter_x2 - inter_x1)
            inter_h = max(0, inter_y2 - inter_y1)

            # Portion of the detected plate that lies inside the ROI.
            overlap_ratio = (inter_w * inter_h) / float(box_w * box_h)

            if overlap_ratio >= ROI_MIN_OVERLAP_RATIO and conf > best_conf:
                best = (x1, y1, x2, y2)
                best_conf = conf

        if best is None:
            return None

        x1, y1, x2, y2 = best
        return frame[y1:y2, x1:x2]

    # -----------------------------
    # MAIN PROCESS FUNCTION
    # -----------------------------
    def process(self, frame, roi):
        if frame is None or frame.size == 0:
            return None, 0.0

        h, w = frame.shape[:2]

        x1, y1, x2, y2 = roi

        # Convert percentage ROI -> pixel ROI
        if 0 <= x1 <= 1 and 0 <= x2 <= 1:
            x1 = int(x1 * w)
            x2 = int(x2 * w)

        if 0 <= y1 <= 1 and 0 <= y2 <= 1:
            y1 = int(y1 * h)
            y2 = int(y2 * h)

        # Clamp values
        x1, y1 = max(0, int(x1)), max(0, int(y1))
        x2, y2 = min(w, int(x2)), min(h, int(y2))

        # Handle invalid ROI
        if x2 - x1 <= 0 or y2 - y1 <= 0:
            roi_bounds = None
        else:
            roi_bounds = (x1, y1, x2, y2)

        # DETECT PLATE
        plate_img = self.detect_plate(frame, roi_bounds)

        if plate_img is None or plate_img.size == 0:
            return None, 0.0

        # OCR
        result = self.ocr.extract_text(plate_img)

        if result.text is None:
            return None, 0.0

        return result.text, result.confidence
