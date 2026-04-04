const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:4000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

export function fetchBunks() {
  return request("/bunks");
}

export function createBunk(data) {
  return request("/bunks", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function fetchCameras(bunkId) {
  return request(`/cameras/${bunkId}`);
}

export function createCamera(data) {
  return request("/cameras", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function fetchFrame(cameraId) {
  return request(`/frame/${cameraId}`);
}

export function saveRoi(data) {
  return request("/roi", {
    method: "POST",
    body: JSON.stringify(data)
  });
}
