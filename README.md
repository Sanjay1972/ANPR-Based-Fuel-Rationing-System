# ANPR Fuel Rationing System

This repository contains a multi-service ANPR workflow for:

- managing bunks, cameras, and ROI from an admin dashboard
- assigning cameras to number plate servers by geo proximity and capacity
- processing license plates in real time
- tracking repeat detections per day
- sending email alerts and creating admin review items for fines

## Services

### 1. Admin Dashboard Server

Location:

- `Admin_Dashboard_server/backend`
- `Admin_Dashboard_server/frontend`

Responsibilities:

- create bunks with map-selected coordinates
- add cameras
- draw and save ROI
- review fine candidates in the dashboard

### 2. Application Server

Location:

- `Application_Server`

Responsibilities:

- register number plate servers automatically
- assign ROI-ready cameras to number plate servers
- keep Redis assignment cache updated in real time
- expose long-poll assignment endpoints
- receive finalized detections from number plate servers
- send email on second sighting in a day
- create review-fine records on third sighting in a day

### 3. Unified Number Plate Server

Location:

- `Unified_Number_plate_server`

Responsibilities:

- long-poll for assignments from the application server
- process assigned cameras without interrupting existing running cameras
- send finalized detections to the application server

## Prerequisites

- Windows with Git Bash or PowerShell
- PostgreSQL running locally
- Redis running locally
- Node.js 20+
- Python environment already prepared in `Unified_Number_plate_server/anpr_env`
- `ffmpeg` available on `PATH`

## Database Defaults

Current PostgreSQL connection used by the project:

- host: `localhost`
- port: `5432`
- database: `anpr_system`
- user: `postgres`
- password: `sanjay`

If you change these, update:

- `Admin_Dashboard_server/backend/src/db.js`
- `Unified_Number_plate_server/db/db.py`

## Redis Setup

If Redis is already available through Docker:

```bash
docker start redis
```

Verify:

```bash
docker exec -it redis redis-cli ping
```

Expected:

```text
PONG
```

## Initial Install

### Admin backend

```bash
cd "/e/Petrol Bunk Congestion Management System/Admin_Dashboard_server/backend"
npm install
```

### Admin frontend

```bash
cd "/e/Petrol Bunk Congestion Management System/Admin_Dashboard_server/frontend"
npm install
```

### Application server

```bash
cd "/e/Petrol Bunk Congestion Management System/Application_Server"
npm install
```

### Number plate server

Python packages are installed in:

- `Unified_Number_plate_server/anpr_env`

If needed:

```bash
cd "/e/Petrol Bunk Congestion Management System/Unified_Number_plate_server"
./anpr_env/Scripts/pip.exe install -r requirements.txt
```

## Email Configuration

Application server mail settings are loaded from:

- `Application_Server/.env`

Current values:

- `EMAIL_USER=smsanjay2021@gmail.com`
- `EMAIL_PASS=blhuvoefwrjpwwde`
- `NOTIFICATION_EMAIL=71762205104@cit.edu.in`

Do not commit real credentials to public git repositories.

## Start Order

Start services in this order.

### 1. Start Redis

```bash
docker start redis
```

### 2. Start Admin Backend

This also initializes PostgreSQL tables and triggers.

```bash
cd "/e/Petrol Bunk Congestion Management System/Admin_Dashboard_server/backend"
npm start
```

Expected:

```text
Server running at http://localhost:4000
```

### 3. Start Application Server

```bash
cd "/e/Petrol Bunk Congestion Management System/Application_Server"
npm start
```

Expected:

```text
Application server listening at http://localhost:4100
```

### 4. Start Admin Frontend

```bash
cd "/e/Petrol Bunk Congestion Management System/Admin_Dashboard_server/frontend"
npm run dev
```

Open the Vite URL shown in the terminal.

### 5. Start Number Plate Server 1

From Git Bash:

```bash
cd "/e/Petrol Bunk Congestion Management System/Unified_Number_plate_server"
export ANPR_SERVER_ID=server-1
export NUMBER_PLATE_SERVER_LATITUDE=13.082700
export NUMBER_PLATE_SERVER_LONGITUDE=80.270700
export NUMBER_PLATE_SERVER_CONNECTION_LIMIT=3
export APPLICATION_SERVER_URL=http://127.0.0.1:4100
./anpr_env/Scripts/python.exe main.py
```

This server registers itself automatically with the application server.

### 6. Start Additional Number Plate Servers

Example second server:

```bash
cd "/e/Petrol Bunk Congestion Management System/Unified_Number_plate_server"
export ANPR_SERVER_ID=server-2
export NUMBER_PLATE_SERVER_LATITUDE=12.990000
export NUMBER_PLATE_SERVER_LONGITUDE=80.260000
export NUMBER_PLATE_SERVER_CONNECTION_LIMIT=3
export APPLICATION_SERVER_URL=http://127.0.0.1:4100
./anpr_env/Scripts/python.exe main.py
```

## How Assignment Works

- only cameras with saved ROI are eligible for assignment
- application server assigns cameras based on geo proximity and server capacity
- assignments are sticky, so existing camera assignments are preserved when a new server joins
- each number plate server long-polls for its own assignment updates
- when a server starts, it registers itself automatically

## Detection and Fine Workflow

### First sighting in a day

- detection is stored in `plate_detections`
- no email
- no review fine

### Second sighting in a day

- detection is stored
- email notification is sent to `71762205104@cit.edu.in`

### Third sighting in a day

- detection is stored
- item appears in the admin dashboard under `Review Fines`
- admin can:
  - `Initiate Fine` -> sends email and marks review approved
  - `Reject` -> marks review rejected

## Admin Usage Flow

1. Open admin dashboard
2. Add bunk
3. Choose bunk location from map
4. Add camera
5. Draw ROI
6. Wait for the application server to assign the ROI-ready camera
7. Number plate server starts processing it automatically

## Useful Endpoints

### Admin backend

- `GET http://localhost:4000/api/bunks`
- `POST http://localhost:4000/api/bunks`
- `POST http://localhost:4000/api/cameras`
- `POST http://localhost:4000/api/roi`

### Application server

- `GET http://localhost:4100/api/health`
- `GET http://localhost:4100/api/assignments`
- `GET http://localhost:4100/api/assignments/server-1`
- `GET http://localhost:4100/api/review-fines`
- `POST http://localhost:4100/api/sync`

## Clean Reset

If you want to reset PostgreSQL bunks/cameras/rois and Redis assignment cache, use the cleanup commands you have already been using in this workspace.

## Troubleshooting

### Number plate server shows `WinError 10061`

The application server is not running or not reachable at `http://127.0.0.1:4100`.

### Long poll does not wake after ROI save

Check:

- application server is running
- camera has ROI stored
- number plate server `ANPR_SERVER_ID` matches the registered server
- Redis is running

### Camera not assigned

Check:

- bunk has valid coordinates
- ROI is saved
- a number plate server is registered
- server capacity is not full

### Wrong server receives camera

Check:

- latitude / longitude used for each number plate server
- sticky assignment logic is in the latest application server version

## Verification Commands

### Check Redis

```bash
docker exec -it redis redis-cli ping
```

### Check application server health

```bash
curl http://127.0.0.1:4100/api/health
```

### Check assignments

```bash
curl http://127.0.0.1:4100/api/assignments
curl http://127.0.0.1:4100/api/assignments/server-1
curl http://127.0.0.1:4100/api/assignments/server-2
```
