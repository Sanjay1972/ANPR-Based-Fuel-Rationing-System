from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
from config import INDIAN_PLATE_REGEX

try:
    from paddleocr import PaddleOCR
except ImportError:
    PaddleOCR = None


@dataclass
class OCRResult:
    text: Optional[str]
    confidence: float


class OCRService:
    def __init__(self):
        if PaddleOCR is None:
            raise ImportError("paddleocr not installed")

        self.reader = None
        self._lock = threading.Lock()
        self._initialize()

    def _initialize(self):
        with self._lock:
            if self.reader is None:
                self.reader = PaddleOCR(
                    lang="en",
                    use_textline_orientation=False
                )
        return self.reader

    def warmup(self):
        dummy = np.full((32, 96, 3), 255, dtype=np.uint8)
        self.extract_text(dummy)

    def extract_text(self, image: np.ndarray) -> OCRResult:
        reader = self._initialize()

        image = self._ensure_color(image)

        # 🔥 STEP 1: REMOVE SCREWS / NOISE
        image = self._remove_screw_inpaint(image)

        results = reader.ocr(image, cls=False)

        if not results or not results[0]:
            return OCRResult(None, 0.0)

        texts = []
        confidences = []

        for item in results[0]:
            text, conf = item[1]
            texts.append(str(text))
            confidences.append(float(conf))

        raw_text = "".join(texts).strip()
        normalized = normalize_plate_text(raw_text)

        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

        if not normalized:
            return OCRResult(None, 0.0)

        return OCRResult(normalized, avg_conf)

    @staticmethod
    def _ensure_color(image: np.ndarray) -> np.ndarray:
        if image.ndim == 2:
            return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        return image

    # 🔥 NEW FUNCTION (YOUR LOGIC INTEGRATED)
    @staticmethod
    def _remove_screw_inpaint(img: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        _, mask = cv2.threshold(gray, 60, 255, cv2.THRESH_BINARY_INV)

        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(
            mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )

        clean_mask = np.zeros_like(mask)

        for contour in contours:
            area = cv2.contourArea(contour)

            if 20 < area < 200:
                cv2.drawContours(clean_mask, [contour], -1, 255, -1)

        return cv2.inpaint(img, clean_mask, 3, cv2.INPAINT_TELEA)


# -----------------------------
# NORMALIZATION
# -----------------------------
def normalize_plate_text(text: str) -> Optional[str]:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", text.upper())

    if not cleaned:
        return None

    if len(cleaned) >= 10:
        candidate = cleaned[:10]
        candidate = _normalize_indian_plate(candidate)

        if INDIAN_PLATE_REGEX.match(candidate):
            return candidate

    return cleaned.replace("O", "0").replace("I", "1")


def _normalize_indian_plate(text: str) -> str:
    chars = list(text)

    digit_slots = {2, 3, 6, 7, 8, 9}
    letter_slots = {0, 1, 4, 5}

    digit_map = {"O": "0", "I": "1", "Z": "2", "S": "5", "B": "8"}
    letter_map = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B"}

    for i, ch in enumerate(chars):
        if i in digit_slots and ch in digit_map:
            chars[i] = digit_map[ch]
        elif i in letter_slots and ch in letter_map:
            chars[i] = letter_map[ch]

    return "".join(chars)
