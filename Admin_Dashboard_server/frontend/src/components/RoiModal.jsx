import { useEffect, useRef, useState } from "react";
import { fetchFrame } from "../api";

function normalizeRect(rect) {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height)
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default function RoiModal({ camera, onClose, onSave }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const [frameData, setFrameData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [frameError, setFrameError] = useState("");
  const [actionError, setActionError] = useState("");
  const [draftRect, setDraftRect] = useState(null);
  const [finalRect, setFinalRect] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);

  useEffect(() => {
    if (!camera) {
      setFrameData(null);
      setDraftRect(null);
      setFinalRect(null);
      setFrameError("");
      setActionError("");
      return;
    }

    let mounted = true;

    async function loadFrame() {
      try {
        setLoading(true);
        setFrameError("");
        setActionError("");
        const frame = await fetchFrame(camera.id);
        if (!mounted) {
          return;
        }
        setFrameData(frame);
      } catch (loadError) {
        if (mounted) {
          setFrameError(loadError.message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadFrame();

    return () => {
      mounted = false;
    };
  }, [camera]);

  useEffect(() => {
    if (!frameData || !canvasRef.current || !camera) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const image = new Image();

    image.onload = () => {
      imageRef.current = image;
      canvas.width = image.width;
      canvas.height = image.height;

      if (camera.roi) {
        setFinalRect({
          x: camera.roi.x1 * image.width,
          y: camera.roi.y1 * image.height,
          width: (camera.roi.x2 - camera.roi.x1) * image.width,
          height: (camera.roi.y2 - camera.roi.y1) * image.height
        });
      } else {
        setFinalRect(null);
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
    };

    image.src = `data:${frameData.mimeType};base64,${frameData.imageBase64}`;
  }, [frameData, camera]);

  useEffect(() => {
    redrawCanvas();
  }, [draftRect, finalRect]);

  function redrawCanvas() {
    const canvas = canvasRef.current;
    const image = imageRef.current;

    if (!canvas || !image) {
      return;
    }

    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);

    const rect = draftRect || finalRect;

    if (!rect) {
      return;
    }

    const normalizedRect = normalizeRect(rect);
    context.fillStyle = "rgba(255, 107, 0, 0.18)";
    context.strokeStyle = "#ff6b00";
    context.lineWidth = 3;
    context.fillRect(
      normalizedRect.x,
      normalizedRect.y,
      normalizedRect.width,
      normalizedRect.height
    );
    context.strokeRect(
      normalizedRect.x,
      normalizedRect.y,
      normalizedRect.width,
      normalizedRect.height
    );
  }

  function getCanvasPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: clamp((event.clientX - rect.left) * scaleX, 0, canvas.width),
      y: clamp((event.clientY - rect.top) * scaleY, 0, canvas.height)
    };
  }

  function handlePointerDown(event) {
    if (!frameData || loading) {
      return;
    }

    const point = getCanvasPoint(event);
    setStartPoint(point);
    setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
    setIsDrawing(true);
  }

  function handlePointerMove(event) {
    if (!isDrawing || !startPoint) {
      return;
    }

    const point = getCanvasPoint(event);
    setDraftRect({
      x: startPoint.x,
      y: startPoint.y,
      width: point.x - startPoint.x,
      height: point.y - startPoint.y
    });
  }

  function handlePointerUp() {
    if (!draftRect) {
      return;
    }

    const normalized = normalizeRect(draftRect);
    setFinalRect(normalized);
    setDraftRect(null);
    setIsDrawing(false);
    setStartPoint(null);
  }

  async function handleSave() {
    const canvas = canvasRef.current;

    if (!canvas || !finalRect) {
      setActionError("Draw an ROI rectangle before saving.");
      return;
    }

    const normalizedRect = normalizeRect(finalRect);

    if (normalizedRect.width < 2 || normalizedRect.height < 2) {
      setActionError("ROI must cover a visible area before saving.");
      return;
    }

    try {
      setSaving(true);
      setActionError("");
      await onSave(camera.id, {
        x1: normalizedRect.x / canvas.width,
        y1: normalizedRect.y / canvas.height,
        x2: (normalizedRect.x + normalizedRect.width) / canvas.width,
        y2: (normalizedRect.y + normalizedRect.height) / canvas.height
      });
      onClose();
    } catch (saveError) {
      setActionError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!camera) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="card-tag">ROI Editor</p>
            <h3>Camera {camera.camera_number}</h3>
            <p className="muted modal-path">{camera.video_path}</p>
          </div>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? (
          <div className="modal-loading">Extracting first frame from video...</div>
        ) : frameError ? (
          <div className="banner banner-error">{frameError}</div>
        ) : (
          <>
            <div className="modal-instructions">
              Click and drag on the frame to draw the ROI. Saving stores normalized coordinates
              in PostgreSQL.
            </div>
            {actionError && <div className="banner banner-error">{actionError}</div>}
            <div className="canvas-shell">
              <canvas
                ref={canvasRef}
                className="roi-canvas"
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={() => {
                  if (isDrawing) {
                    handlePointerUp();
                  }
                }}
              />
            </div>
          </>
        )}

        <div className="modal-footer">
          <button className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" onClick={handleSave} disabled={loading || saving}>
            {saving ? "Saving..." : "Save ROI"}
          </button>
        </div>
      </div>
    </div>
  );
}
