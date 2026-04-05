import { useEffect, useRef, useState } from "react";

const DEFAULT_CENTER = { latitude: 13.0827, longitude: 80.2707 };
const DEFAULT_ZOOM = 13;

function parseCoordinate(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "";
}

function isValidPoint(point) {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export default function MapPickerModal({
  isOpen,
  initialLatitude,
  initialLongitude,
  onClose,
  onSelect
}) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [selectedPoint, setSelectedPoint] = useState(() => ({
    latitude: parseCoordinate(initialLatitude) ?? DEFAULT_CENTER.latitude,
    longitude: parseCoordinate(initialLongitude) ?? DEFAULT_CENTER.longitude
  }));
  const hasLeaflet = typeof window !== "undefined" && Boolean(window.L);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const latitude = parseCoordinate(initialLatitude);
    const longitude = parseCoordinate(initialLongitude);

    setSelectedPoint({
      latitude: latitude ?? DEFAULT_CENTER.latitude,
      longitude: longitude ?? DEFAULT_CENTER.longitude
    });

    return undefined;
  }, [initialLatitude, initialLongitude, isOpen]);

  useEffect(() => {
    if (!isOpen || !mapElementRef.current || !hasLeaflet || !isValidPoint(selectedPoint)) {
      return undefined;
    }

    if (!mapRef.current) {
      const map = window.L.map(mapElementRef.current, {
        center: [selectedPoint.latitude, selectedPoint.longitude],
        zoom: DEFAULT_ZOOM
      });

      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);

      const marker = window.L.marker([selectedPoint.latitude, selectedPoint.longitude], {
        draggable: true
      }).addTo(map);

      map.on("click", (event) => {
        const nextPoint = {
          latitude: event.latlng.lat,
          longitude: event.latlng.lng
        };

        marker.setLatLng(event.latlng);
        setSelectedPoint(nextPoint);
      });

      marker.on("dragend", () => {
        const position = marker.getLatLng();
        setSelectedPoint({
          latitude: position.lat,
          longitude: position.lng
        });
      });

      mapRef.current = map;
      markerRef.current = marker;
    } else {
      mapRef.current.setView([selectedPoint.latitude, selectedPoint.longitude], mapRef.current.getZoom());
      markerRef.current?.setLatLng([selectedPoint.latitude, selectedPoint.longitude]);
    }

    window.setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 0);

    return undefined;
  }, [hasLeaflet, isOpen, selectedPoint.latitude, selectedPoint.longitude]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card map-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Location Picker</p>
            <h3>Select Bunk Coordinates</h3>
            <p className="map-picker-header-copy">
              Click anywhere on the map or drag the marker to the bunk location.
            </p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="map-picker-layout">
          <div className="map-picker-toolbar">
            <div className="field-group">
              <label htmlFor="map-picker-latitude">Latitude</label>
              <input
                id="map-picker-latitude"
                value={formatCoordinate(selectedPoint.latitude)}
                onChange={(event) =>
                  setSelectedPoint((current) => ({
                    ...current,
                    latitude: parseCoordinate(event.target.value)
                  }))
                }
                inputMode="decimal"
              />
            </div>
            <div className="field-group">
              <label htmlFor="map-picker-longitude">Longitude</label>
              <input
                id="map-picker-longitude"
                value={formatCoordinate(selectedPoint.longitude)}
                onChange={(event) =>
                  setSelectedPoint((current) => ({
                    ...current,
                    longitude: parseCoordinate(event.target.value)
                  }))
                }
                inputMode="decimal"
              />
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={!isValidPoint(selectedPoint)}
              onClick={() => {
                mapRef.current?.setView([selectedPoint.latitude, selectedPoint.longitude], DEFAULT_ZOOM);
                markerRef.current?.setLatLng([selectedPoint.latitude, selectedPoint.longitude]);
              }}
            >
              Center Marker
            </button>
          </div>

          <div className="map-shell">
            {hasLeaflet ? (
              <div ref={mapElementRef} className="map-surface" />
            ) : (
              <div className="map-fallback">
                Leaflet map could not load. Enter latitude and longitude manually above.
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <div className="muted">
            {isValidPoint(selectedPoint)
              ? `Selected: ${selectedPoint.latitude.toFixed(6)}, ${selectedPoint.longitude.toFixed(6)}`
              : "Enter valid latitude and longitude values to continue."}
          </div>
          <div className="inline-actions">
            <button className="ghost-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!isValidPoint(selectedPoint)}
              onClick={() => onSelect(selectedPoint)}
            >
              Use Coordinates
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
