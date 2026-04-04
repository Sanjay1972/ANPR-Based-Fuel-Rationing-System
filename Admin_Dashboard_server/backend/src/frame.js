import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

/**
 * Normalize and resolve video path safely
 */
function resolveVideoPath(videoPath) {
  if (!videoPath || typeof videoPath !== "string") {
    throw new Error("Invalid video path provided");
  }

  // 🔥 CLEAN INPUT (VERY IMPORTANT)
  let cleanedPath = videoPath
    .trim()                        // remove spaces
    .replace(/^"+|"+$/g, "")      // remove surrounding quotes
    .replace(/\//g, "\\");        // normalize slashes for Windows

  console.log("📥 RAW PATH FROM DB:", videoPath);
  console.log("🧹 CLEANED PATH:", cleanedPath);

  // ✅ Detect Windows absolute path manually (extra safety)
  const isWindowsAbsolute = /^[A-Za-z]:\\/.test(cleanedPath);

  if (path.isAbsolute(cleanedPath) || isWindowsAbsolute) {
    console.log("✅ Using absolute path");
    return cleanedPath;
  }

  // ✅ Relative path → resolve from project root
  const resolved = path.resolve(process.cwd(), cleanedPath);
  console.log("📂 Resolved relative path:", resolved);

  return resolved;
}

/**
 * Extract frame from video using ffmpeg
 * @param {string} videoPath
 * @param {string} time - timestamp (default 1 second)
 */
export async function extractFrame(videoPath, time = "00:00:01") {
  const resolvedVideoPath = resolveVideoPath(videoPath);

  console.log("🎥 Extracting frame from:", resolvedVideoPath);

  // ✅ Check if file exists
  try {
    await fs.access(resolvedVideoPath);
  } catch {
    throw new Error(`Video file not found: ${resolvedVideoPath}`);
  }

  let stdout;

  try {
    const result = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        time,
        "-i",
        resolvedVideoPath,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1"
      ],
      {
        encoding: "buffer",
        maxBuffer: 20 * 1024 * 1024 // 20MB
      }
    );

    stdout = result.stdout;
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        "ffmpeg not found. Please install ffmpeg and add it to system PATH."
      );
    }

    console.error("❌ FFmpeg error:", err.stderr || err.message);
    throw new Error("Failed to extract frame using ffmpeg.");
  }

  if (!stdout || stdout.length === 0) {
    throw new Error("Frame extraction returned empty image.");
  }

  return {
    mimeType: "image/png",
    imageBase64: stdout.toString("base64"),
    resolvedVideoPath
  };
}