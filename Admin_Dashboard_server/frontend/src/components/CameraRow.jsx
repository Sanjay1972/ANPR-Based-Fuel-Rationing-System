export default function CameraRow({ camera, onDrawRoi }) {
  return (
    <div className="camera-row">
      <div className="camera-number">Camera {camera.camera_number}</div>
      <div className="camera-path" title={camera.video_path}>
        {camera.video_path}
      </div>
      <div className="camera-actions">
        <button className="secondary-button" onClick={onDrawRoi}>
          Draw ROI
        </button>
        <span className={`roi-pill ${camera.roi ? "roi-saved" : "roi-pending"}`}>
          {camera.roi ? "Saved" : "Pending"}
        </span>
      </div>
    </div>
  );
}
