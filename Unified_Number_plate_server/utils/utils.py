import re
import os
from config import PLATE_REGEX
from urllib.parse import unquote

def normalize_plate(p):
    return p.replace(" ", "").upper()


def valid_plate(p):
    return re.match(PLATE_REGEX, p) is not None


def similarity(p1, p2):
    if len(p1) != len(p2):
        return 0
    matches = sum(c1 == c2 for c1, c2 in zip(p1, p2))
    return matches / len(p1)


# 🔥 NEW FUNCTION


def normalize_video_path(video_path: str) -> str:
    if not video_path or not isinstance(video_path, str):
        raise ValueError("Invalid video path")

    video_path = video_path.strip().strip('"').strip("'")

    # 🔥 FIX: decode %20 → space
    video_path = unquote(video_path)

    if video_path.startswith(("rtsp://", "http://", "https://")):
        return video_path

    video_path = video_path.replace("\\", "/")

    if not os.path.isabs(video_path):
        video_path = os.path.abspath(video_path)

    video_path = video_path.replace("\\", "/")

    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    return video_path