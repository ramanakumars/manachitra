// Lon/lat grid: OL's Graticule, which works in EPSG:4326 lon/lat. That's
// safe for planetary views: proj4js skips the datum step for CRSs without
// +datum/+towgs84 (all of ours), so EPSG:4326 lon/lat is used as the body's
// planetographic lon/lat as-is, and every distance comes from the view
// projection on the body ellipsoid (1 deg of Jupiter latitude at the equator
// is 1091 km between grid lines, matching PROJ geod, not Earth's 111 km).
// Graticule picks its spacing from view metres, not Earth radii. The view
// projection must have `worldExtent` set (registerAll does this).
import Graticule from "ol/layer/Graticule.js";
import Stroke from "ol/style/Stroke.js";
import Text from "ol/style/Text.js";
import Fill from "ol/style/Fill.js";

/**
 * Degrees as "30°N", "45.5°W", trimming trailing zeros (Graticule intervals
 * go down to arc-seconds when zoomed in).
 * @param pos Hemisphere letter for deg >= 0.
 * @param neg Hemisphere letter for deg < 0.
 */
export function formatDegrees(deg: number, pos: string, neg: string): string {
    const value = Number(Math.abs(deg).toFixed(4)); // drops trailing zeros
    if (value === 0) return "0°";
    return `${value}°${deg >= 0 ? pos : neg}`;
}

const label = (textAlign: CanvasTextAlign) =>
    new Text({
        font: "11px system-ui, sans-serif",
        textAlign,
        fill: new Fill({ color: "rgba(255, 255, 255, 0.95)" }),
        stroke: new Stroke({ color: "rgba(0, 0, 0, 0.75)", width: 3 }),
    });

/** A labelled lon/lat grid layer, hidden until toggled on. */
export function createGraticule({ visible = false } = {}): Graticule {
    return new Graticule({
        visible,
        showLabels: true,
        wrapX: false,
        // Mid-gray reads over imagery and over light or dark page backgrounds.
        strokeStyle: new Stroke({
            color: "rgba(128, 128, 128, 0.8)",
            width: 1,
            lineDash: [2, 3],
        }),
        lonLabelFormatter: (lon) => formatDegrees(lon, "E", "W"),
        latLabelFormatter: (lat) => formatDegrees(lat, "N", "S"),
        // Lat labels on the left (toolbar is top right), lon labels just
        // above the bottom edge (status and lon/lat readout sit on it).
        latLabelPosition: 0.01,
        lonLabelPosition: 0.05,
        latLabelStyle: label("start"),
        lonLabelStyle: label("center"),
        properties: { name: "graticule" },
    });
}
