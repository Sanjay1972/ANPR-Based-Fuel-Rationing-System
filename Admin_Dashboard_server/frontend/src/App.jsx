import { useEffect, useState } from "react";
import {
  approveReviewFine,
  createBunk,
  createCamera,
  fetchBunks,
  fetchCameras,
  fetchReviewFines,
  rejectReviewFine,
  saveRoi
} from "./api";
import BunkCard from "./components/BunkCard.jsx";
import MapPickerModal from "./components/MapPickerModal.jsx";
import RoiModal from "./components/RoiModal.jsx";

const initialBunkForm = {
  name: "",
  address: "",
  latitude: "",
  longitude: ""
};

export default function App() {
  const [bunks, setBunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bunkForm, setBunkForm] = useState(initialBunkForm);
  const [isAddingBunk, setIsAddingBunk] = useState(false);
  const [banner, setBanner] = useState(null);
  const [activeCamera, setActiveCamera] = useState(null);
  const [busyBunkIds, setBusyBunkIds] = useState([]);
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false);
  const [reviewFines, setReviewFines] = useState([]);
  const [activeView, setActiveView] = useState("operations");
  const [reviewFrameIndexes, setReviewFrameIndexes] = useState({});
  const [refreshingReviewFines, setRefreshingReviewFines] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      setLoading(true);
      const bunkList = await fetchBunks();
      const bunkWithCameras = await Promise.all(
        bunkList.map(async (bunk) => ({
          ...bunk,
          cameras: await fetchCameras(bunk.id)
        }))
      );
      setBunks(bunkWithCameras);
      const reviewFineList = await fetchReviewFines();
      setReviewFines(reviewFineList.filter((item) => item.status === "pending"));
    } catch (error) {
      setBanner({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleAddBunk(event) {
    event.preventDefault();

    try {
      const newBunk = await createBunk(bunkForm);
      setBunks((current) => [...current, { ...newBunk, cameras: [] }]);
      setBunkForm(initialBunkForm);
      setIsAddingBunk(false);
      setBanner({ type: "success", text: `Bunk "${newBunk.name}" created.` });
    } catch (error) {
      setBanner({ type: "error", text: error.message });
    }
  }

  async function handleAddCamera(bunkId, videoPath) {
    try {
      setBusyBunkIds((current) => [...current, bunkId]);
      const newCamera = await createCamera({ bunk_id: bunkId, video_path: videoPath });
      setBunks((current) =>
        current.map((bunk) =>
          bunk.id === bunkId ? { ...bunk, cameras: [...bunk.cameras, newCamera] } : bunk
        )
      );
      setBanner({
        type: "success",
        text: `Camera ${newCamera.camera_number} added to bunk ${bunkId}.`
      });
    } catch (error) {
      setBanner({ type: "error", text: error.message });
      throw error;
    } finally {
      setBusyBunkIds((current) => current.filter((id) => id !== bunkId));
    }
  }

  async function handleSaveRoi(cameraId, roi) {
    const savedRoi = await saveRoi({ camera_id: cameraId, roi });

    setBunks((current) =>
      current.map((bunk) => ({
        ...bunk,
        cameras: bunk.cameras.map((camera) =>
          camera.id === cameraId ? { ...camera, roi: savedRoi } : camera
        )
      }))
    );

    setBanner({ type: "success", text: `ROI saved for camera ${cameraId}.` });
    loadDashboard();
  }

  async function handleReviewAction(reviewFineId, action) {
    try {
      if (action === "approve") {
        await approveReviewFine(reviewFineId);
        setBanner({ type: "success", text: `Fine initiated for review #${reviewFineId}.` });
      } else {
        await rejectReviewFine(reviewFineId);
        setBanner({ type: "success", text: `Review #${reviewFineId} rejected.` });
      }

      setReviewFines((current) => current.filter((item) => item.id !== reviewFineId));
    } catch (error) {
      setBanner({ type: "error", text: error.message });
    }
  }

  async function handleRefreshReviewFines() {
    try {
      setRefreshingReviewFines(true);
      const reviewFineList = await fetchReviewFines();
      setReviewFines(reviewFineList.filter((item) => item.status === "pending"));
      setBanner({ type: "success", text: "Review fines refreshed." });
    } catch (error) {
      setBanner({ type: "error", text: error.message });
    } finally {
      setRefreshingReviewFines(false);
    }
  }

  function formatDetectionTime(value) {
    if (!value) {
      return "Unknown time";
    }

    return new Date(value).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "medium"
    });
  }

  function shiftReviewFrame(reviewFineId, totalFrames, direction) {
    setReviewFrameIndexes((current) => {
      const currentIndex = current[reviewFineId] || 0;
      const nextIndex = (currentIndex + direction + totalFrames) % totalFrames;
      return { ...current, [reviewFineId]: nextIndex };
    });
  }

  return (
    <div className="app-shell">
      <div className="background-grid" />
      <main className="dashboard">
        <section className="hero-card">
          <div>
            <p className="eyebrow">ANPR Control Center</p>
            <h1>Admin Dashboard</h1>
            <p className="hero-copy">
              Manage bunks, attach cameras, and draw precise ROI boundaries from extracted
              video frames in one place.
            </p>
          </div>
          <button className="primary-button" onClick={() => setIsAddingBunk((value) => !value)}>
            + Add Bunk
          </button>
        </section>

        <section className="panel nav-panel">
          <button
            className={`nav-chip ${activeView === "operations" ? "nav-chip-active" : ""}`}
            type="button"
            onClick={() => setActiveView("operations")}
          >
            Operations
          </button>
          <button
            className={`nav-chip ${activeView === "review" ? "nav-chip-active" : ""}`}
            type="button"
            onClick={() => setActiveView("review")}
          >
            Review Fines
          </button>
        </section>

        {activeView === "operations" && isAddingBunk && (
          <form className="panel form-panel" onSubmit={handleAddBunk}>
            <div className="field-group">
              <label htmlFor="bunk-name">Bunk Name</label>
              <input
                id="bunk-name"
                value={bunkForm.name}
                onChange={(event) =>
                  setBunkForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Downtown Fuel Point"
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="bunk-address">Address</label>
              <input
                id="bunk-address"
                value={bunkForm.address}
                onChange={(event) =>
                  setBunkForm((current) => ({ ...current, address: event.target.value }))
                }
                placeholder="12 Ring Road, Chennai"
                required
              />
            </div>
            <div className="field-group">
              <label>Coordinates</label>
              <div className="coordinate-picker-row">
                <input
                  value={bunkForm.latitude}
                  onChange={(event) =>
                    setBunkForm((current) => ({ ...current, latitude: event.target.value }))
                  }
                  placeholder="Latitude"
                  inputMode="decimal"
                />
                <input
                  value={bunkForm.longitude}
                  onChange={(event) =>
                    setBunkForm((current) => ({ ...current, longitude: event.target.value }))
                  }
                  placeholder="Longitude"
                  inputMode="decimal"
                />
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setIsMapPickerOpen(true)}
                >
                  Choose From Map
                </button>
              </div>
              <p className="helper-text">
                Pick a point on the map or enter latitude and longitude manually.
              </p>
            </div>
            <div className="inline-actions">
              <button className="primary-button" type="submit">
                Create Bunk
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setIsAddingBunk(false);
                  setBunkForm(initialBunkForm);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {banner && (
          <div className={`banner banner-${banner.type}`}>
            <span>{banner.text}</span>
            <button className="banner-close" onClick={() => setBanner(null)}>
              Dismiss
            </button>
          </div>
        )}

        {activeView === "operations" ? (
          loading ? (
            <section className="panel loading-panel">Loading bunks and cameras...</section>
          ) : (
            bunks.length === 0 ? (
              <section className="panel empty-state">
                No bunks yet. Use <strong>+ Add Bunk</strong> to create your first bunk card.
              </section>
            ) : (
              <section className="bunk-grid">
                {bunks.map((bunk) => (
                  <BunkCard
                    key={bunk.id}
                    bunk={bunk}
                    onAddCamera={handleAddCamera}
                    onDrawRoi={setActiveCamera}
                    busy={busyBunkIds.includes(bunk.id)}
                  />
                ))}
              </section>
            )
          )
        ) : (
          <section className="panel review-panel">
            <div className="review-panel-header">
              <div>
                <p className="eyebrow">Enforcement</p>
                <h2>Review Fines</h2>
                <p className="muted">
                  Plates detected three or more times in a day appear here for admin review.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={handleRefreshReviewFines}
                disabled={refreshingReviewFines}
              >
                {refreshingReviewFines ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {reviewFines.length === 0 ? (
              <div className="camera-empty">No pending review fines right now.</div>
            ) : (
              <div className="review-list">
                {reviewFines.map((item) => {
                  const detections = item.detections || [];
                  const currentFrameIndex = reviewFrameIndexes[item.id] || 0;
                  const currentDetection = detections[currentFrameIndex];

                  return (
                    <article key={item.id} className="review-wide-card">
                      <div className="review-media-column">
                        <div className="review-carousel">
                          <button
                            className="carousel-arrow"
                            type="button"
                            disabled={detections.length <= 1}
                            onClick={() => shiftReviewFrame(item.id, detections.length, -1)}
                          >
                            ←
                          </button>
                          <div className="review-image-shell review-image-shell-wide">
                            {currentDetection ? (
                              <img
                                className="review-image review-image-wide"
                                src={`data:${currentDetection.mime_type};base64,${currentDetection.image_base64}`}
                                alt={`Plate ${item.plate} detection ${currentDetection.id}`}
                              />
                            ) : (
                              <div className="review-image-empty">No frame available.</div>
                            )}
                          </div>
                          <button
                            className="carousel-arrow"
                            type="button"
                            disabled={detections.length <= 1}
                            onClick={() => shiftReviewFrame(item.id, detections.length, 1)}
                          >
                            →
                          </button>
                        </div>
                        <div className="review-frame-meta">
                          <div className="review-frame-counter">
                            Frame {detections.length === 0 ? 0 : currentFrameIndex + 1} of{" "}
                            {detections.length}
                          </div>
                          {currentDetection && (
                            <div className="review-timestamp-card">
                              <span className="review-meta-label">Captured At</span>
                              <span className="review-meta-value">
                                {formatDetectionTime(currentDetection.detected_at)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="review-card-body review-card-body-wide">
                        <p className="card-tag">Review #{item.id}</p>
                        <h3>{item.plate}</h3>
                        <div className="review-detail-grid">
                          <div className="review-detail-card">
                            <span className="review-meta-label">Review Date</span>
                            <span className="review-meta-value">{item.review_date}</span>
                          </div>
                          <div className="review-detail-card">
                            <span className="review-meta-label">Detections</span>
                            <span className="review-meta-value">{detections.length} frames</span>
                          </div>
                          <div className="review-detail-card">
                            <span className="review-meta-label">Status</span>
                            <span className="review-meta-value review-status-pill">
                              Pending Review
                            </span>
                          </div>
                        </div>
                        <div className="inline-actions">
                          <button
                            className="primary-button"
                            type="button"
                            onClick={() => handleReviewAction(item.id, "approve")}
                          >
                            Initiate Fine
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => handleReviewAction(item.id, "reject")}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      <RoiModal
        camera={activeCamera}
        onClose={() => setActiveCamera(null)}
        onSave={handleSaveRoi}
      />

      <MapPickerModal
        isOpen={isMapPickerOpen}
        initialLatitude={bunkForm.latitude}
        initialLongitude={bunkForm.longitude}
        onClose={() => setIsMapPickerOpen(false)}
        onSelect={({ latitude, longitude }) => {
          setBunkForm((current) => ({
            ...current,
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6)
          }));
          setIsMapPickerOpen(false);
        }}
      />
    </div>
  );
}
