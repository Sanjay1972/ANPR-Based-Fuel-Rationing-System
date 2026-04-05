# ANPR Fuel Rationing System

This project is a multi-service ANPR pipeline for petrol bunks. An admin dashboard is used to add bunks, cameras, and ROIs. An application server assigns ROI-ready cameras to number plate servers based on location and capacity, and the number plate servers process video streams and report detections.

## Techniques Used

- GeoRouting for nearest-server camera assignment
- Redis Caching for assignment state and 15-minute duplicate suppression
- Long Polling for real-time assignment updates
- Per-camera worker threads with a shared locked inference pipeline
- YOLO for plate detection / tracking
- PaddleOCR for plate text recognition

## Services

1. `Admin_Dashboard_server`
   Admin UI + backend for bunks, cameras, ROI, and review fines.
2. `Application_Server`
   Real-time assignment, detection intake, mail notifications, and cleanup worker.
3. `Unified_Number_plate_server`
   Video processing server that long-polls assignments and sends detections upstream.

## Prerequisites

- PostgreSQL running locally
- Redis running locally
- Node.js installed
- Python environment available at `Unified_Number_plate_server/anpr_env`

## Run Steps

1. Start Redis
```bash
docker start redis
```

2. Start the admin backend
```bash
cd "/e/Petrol Bunk Congestion Management System/Admin_Dashboard_server/backend"
npm install
npm start
```

3. Start the application server
```bash
cd "/e/Petrol Bunk Congestion Management System/Application_Server"
npm install
npm start
```

4. Start the cleanup worker
```bash
cd "/e/Petrol Bunk Congestion Management System/Application_Server"
npm run cleanup
```

5. Start the admin frontend
```bash
cd "/e/Petrol Bunk Congestion Management System/Admin_Dashboard_server/frontend"
npm install
npm run dev
```

6. Start number plate server 1
```bash
cd "/e/Petrol Bunk Congestion Management System/Unified_Number_plate_server"
export ANPR_SERVER_ID=server-1
export NUMBER_PLATE_SERVER_LATITUDE=13.082700
export NUMBER_PLATE_SERVER_LONGITUDE=80.270700
export NUMBER_PLATE_SERVER_CONNECTION_LIMIT=3
export APPLICATION_SERVER_URL=http://127.0.0.1:4100
./anpr_env/Scripts/python.exe main.py
```

7. Start another number plate server if needed
```bash
cd "/e/Petrol Bunk Congestion Management System/Unified_Number_plate_server"
export ANPR_SERVER_ID=server-2
export NUMBER_PLATE_SERVER_LATITUDE=12.990000
export NUMBER_PLATE_SERVER_LONGITUDE=80.260000
export NUMBER_PLATE_SERVER_CONNECTION_LIMIT=3
export APPLICATION_SERVER_URL=http://127.0.0.1:4100
./anpr_env/Scripts/python.exe main.py
```

## Basic Flow

1. Add a bunk from the admin dashboard and choose its location from the map.
2. Add cameras to that bunk.
3. Draw and save ROI for each camera.
4. The application server assigns eligible cameras to number plate servers.
5. Number plate servers process the streams and send detections to the application server.
6. Second sighting in a day sends mail.
7. Third sighting in a day appears in `Review Fines` for admin action.
