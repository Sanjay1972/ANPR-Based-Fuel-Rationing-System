import { useEffect, useState } from "react";
import { createBunk, createCamera, fetchBunks, fetchCameras, saveRoi } from "./api";
import BunkCard from "./components/BunkCard.jsx";
import RoiModal from "./components/RoiModal.jsx";

const initialBunkForm = {
  name: "",
  address: ""
};

export default function App() {
  const [bunks, setBunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bunkForm, setBunkForm] = useState(initialBunkForm);
  const [isAddingBunk, setIsAddingBunk] = useState(false);
  const [banner, setBanner] = useState(null);
  const [activeCamera, setActiveCamera] = useState(null);
  const [busyBunkIds, setBusyBunkIds] = useState([]);

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

        {isAddingBunk && (
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

        {loading ? (
          <section className="panel loading-panel">Loading bunks and cameras...</section>
        ) : bunks.length === 0 ? (
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
        )}
      </main>

      <RoiModal
        camera={activeCamera}
        onClose={() => setActiveCamera(null)}
        onSave={handleSaveRoi}
      />
    </div>
  );
}
