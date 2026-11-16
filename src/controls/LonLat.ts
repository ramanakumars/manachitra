// Cursor longitude/latitude readout (bottom right).
// Planetographic latitude (geodetic, on the body's reference ellipsoid),
// east-positive longitude in [-180, 180].
import MousePosition from "ol/control/MousePosition.js";
import { containsCoordinate, getWidth } from "ol/extent.js";
import proj4 from "proj4";
import type { Coordinate } from "ol/coordinate.js";
import type { Body } from "../bodies.js";
import { ellipsoid } from "../projections.js";
import type { ViewCrs } from "../projections.js";

const PLACEHOLDER = "–";

/**
 * Format as "12.34°N  56.78°W".
 * @param lonLat [lon, lat] in degrees.
 */
export function formatLonLat([lon, lat]: Coordinate, digits = 2): string {
    const ns = `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? "N" : "S"}`;
    const ew = `${Math.abs(lon).toFixed(digits)}°${lon >= 0 ? "E" : "W"}`;
    return `${ns}  ${ew}`;
}

/**
 * Formatter from view coordinates to a lon/lat string. Points outside the
 * view extent, or where the projection doesn't round-trip (e.g. outside the
 * Mollweide ellipse), show a placeholder.
 */
export function lonLatFormatter(
    view: ViewCrs,
    body: Body,
): (coord?: Coordinate) => string {
    // Geographic CRS as a string only: registering a longlat def would give
    // OL an Earth-based metersPerUnit.
    const geo = `+proj=longlat ${ellipsoid(body)} +no_defs`;
    const toGeo = proj4(view.def, geo);
    const tolerance = 1e-6 * getWidth(view.extent);
    return (coord) => {
        if (!coord || !containsCoordinate(view.extent, coord)) {
            return PLACEHOLDER;
        }
        const lonLat = toGeo.forward(coord);
        if (!lonLat.every(Number.isFinite)) return PLACEHOLDER;
        const back = toGeo.inverse(lonLat);
        const err = Math.hypot(back[0] - coord[0], back[1] - coord[1]);
        return err <= tolerance ? formatLonLat(lonLat) : PLACEHOLDER;
    };
}

export class LonLat extends MousePosition {
    constructor(view: ViewCrs, body: Body) {
        super({
            className: "mc-lonlat",
            coordinateFormat: lonLatFormatter(view, body),
            placeholder: PLACEHOLDER,
        });
    }
}
