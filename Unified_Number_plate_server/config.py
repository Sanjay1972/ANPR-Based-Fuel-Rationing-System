from __future__ import annotations

import os
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

# Assignment / Redis
USE_REDIS_ASSIGNMENTS = os.getenv("USE_REDIS_ASSIGNMENTS", "1") == "1"
ANPR_SERVER_ID = os.getenv("ANPR_SERVER_ID", "server-1")
REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
REDIS_SERVER_ASSIGNMENTS_KEY = "anpr:server_assignments:{server_id}"
APPLICATION_SERVER_URL = os.getenv("APPLICATION_SERVER_URL", "http://127.0.0.1:4100")
ASSIGNMENT_LONG_POLL_TIMEOUT = int(os.getenv("ASSIGNMENT_LONG_POLL_TIMEOUT", "25"))
ASSIGNMENT_POLL_RETRY_INITIAL_DELAY = float(
    os.getenv("ASSIGNMENT_POLL_RETRY_INITIAL_DELAY", "2")
)
ASSIGNMENT_POLL_RETRY_MAX_DELAY = float(
    os.getenv("ASSIGNMENT_POLL_RETRY_MAX_DELAY", "30")
)
NUMBER_PLATE_SERVER_LATITUDE = float(os.getenv("NUMBER_PLATE_SERVER_LATITUDE", "13.082700"))
NUMBER_PLATE_SERVER_LONGITUDE = float(os.getenv("NUMBER_PLATE_SERVER_LONGITUDE", "80.270700"))
NUMBER_PLATE_SERVER_CONNECTION_LIMIT = int(
    os.getenv("NUMBER_PLATE_SERVER_CONNECTION_LIMIT", "3")
)

# Model and plate rules
YOLO_MODEL_PATH = "models/license_plate_detector.pt"
INDIAN_PLATE_REGEX = re.compile(r"^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{1,4}$")
PLATE_REGEX = r"^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$"
