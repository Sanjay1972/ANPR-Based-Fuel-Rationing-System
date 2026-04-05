import { useState } from "react";
import CameraRow from "./CameraRow.jsx";

function hasValidCoordinates(bunk) {
  return Number.isFinite(Number(bunk.latitude)) && Number.isFinite(Number(bunk.longitude));
}

export default function BunkCard({ bunk, onAddCamera, onDrawRoi, busy }) {
  const [isAddingCamera, setIsAddingCamera] = useState(false);
  const [videoPath, setVideoPath] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    try {
      await onAddCamera(bunk.id, videoPath);
      setVideoPath("");
      setIsAddingCamera(false);
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  return (
    <article className="panel bunk-card">
      <div className="bunk-card-header">
        <div>
          <p className="card-tag">Bunk #{bunk.id}</p>
          <h2>{bunk.name}</h2>
          <p className="muted">{bunk.address}</p>
          {hasValidCoordinates(bunk) && (
            <p className="coordinate-text">
              {Number(bunk.latitude).toFixed(6)}, {Number(bunk.longitude).toFixed(6)}
            </p>
          )}
        </div>
        <button className="secondary-button" onClick={() => setIsAddingCamera((value) => !value)}>
          + Add Camera
        </button>
      </div>

      {isAddingCamera && (
        <form className="camera-form" onSubmit={handleSubmit}>
          <div className="field-group grow">
            <label htmlFor={`video-path-${bunk.id}`}>Video Path</label>
            <input
              id={`video-path-${bunk.id}`}
              value={videoPath}
              onChange={(event) => setVideoPath(event.target.value)}
              placeholder="E:\\videos\\lane-1.mp4"
              required
            />
          </div>
          <div className="inline-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Adding..." : "Save Camera"}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setIsAddingCamera(false);
                setVideoPath("");
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          {error && <p className="inline-error">{error}</p>}
        </form>
      )}

      <div className="camera-list">
        <div className="camera-list-head">
          <span>Camera Number</span>
          <span>Video Path</span>
          <span>ROI</span>
        </div>
        {bunk.cameras.length === 0 ? (
          <div className="camera-empty">No cameras attached yet.</div>
        ) : (
          bunk.cameras.map((camera) => (
            <CameraRow key={camera.id} camera={camera} onDrawRoi={() => onDrawRoi(camera)} />
          ))
        )}
      </div>
    </article>
  );
}
