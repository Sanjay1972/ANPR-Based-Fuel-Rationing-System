from __future__ import annotations

import re


# Processing cadence
PROCESS_INTERVAL = 2
MAX_MISSED_FRAMES = 3
TIMEOUT_SECONDS = PROCESS_INTERVAL * MAX_MISSED_FRAMES

# Track / save thresholds
SIMILARITY_THRESHOLD = 0.7
SAVE_CONFIDENCE_THRESHOLD = 0.60
ROI_MIN_OVERLAP_RATIO = 0.80

# Cache and output
CACHE_TTL = 900
OUTPUT_DIR = "op"

# Model and plate rules
YOLO_MODEL_PATH = "models/license_plate_detector.pt"
INDIAN_PLATE_REGEX = re.compile(r"^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{1,4}$")
PLATE_REGEX = r"^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$"
