# ANPR Admin Dashboard

Single-page admin dashboard for managing bunks, cameras, and ROI configuration for an ANPR system.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL with `pg`
- Frame extraction: `ffmpeg`

## Project Structure

- `backend/` Express API, PostgreSQL schema initialization, ROI persistence, and frame extraction
- `frontend/` React single-page dashboard

## Prerequisites

- Node.js 20+
- PostgreSQL
- `ffmpeg` available on `PATH`

## Environment

Copy `backend/.env.example` to `backend/.env` and update values for your PostgreSQL instance.

## Install

```bash
cd backend
npm install
cd ../frontend
npm install
```

## Run

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

## API Summary

- `POST /api/bunks`
- `GET /api/bunks`
- `POST /api/cameras`
- `GET /api/cameras/:bunk_id`
- `POST /api/roi`
- `GET /api/frame/:camera_id`

## Notes

- Camera numbers auto-increment per bunk in the backend.
- ROI coordinates are stored normalized to image dimensions.
- Relative `video_path` values are resolved from the backend working directory unless `VIDEO_BASE_PATH` is set.
