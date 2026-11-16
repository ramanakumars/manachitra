// proj4 / OpenLayers CRS registry.
// Order matters: every proj4.defs() must happen before registerAll(), because
// OL's register() loops over the defs present at call time.
import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";
import { get as getProjection } from "ol/proj.js";
import type Projection from "ol/proj/Projection.js";
import {
    boundingExtent,
    buffer,
    containsCoordinate,
    getHeight,
    getIntersection,
    getWidth,
} from "ol/extent.js";
import type { Extent } from "ol/extent.js";
import type { Coordinate } from "ol/coordinate.js";
import type { Body } from "./bodies.js";
import type { ViewCrs } from "./projections.js";

/** Define the view CRS with proj4 (not yet visible to OL). */
export function defineView(view: ViewCrs): void {
    proj4.defs(view.code, view.def);
}

// One code per distinct (normalised) source proj string, so identical CRSs
// are never reprojected against each other.
const codeForDef = new Map<string, string>();

/** Collapse whitespace and add `+units=m` if missing (OL needs units). */
export function normaliseDef(def: string): string {
    let s = def.trim().replace(/\s+/g, " ");
    if (!/\+units=/.test(s)) s += " +units=m"; // OL needs units for metersPerUnit
    return s;
}

/**
 * Code for a source CRS, e.g. `JUP:SRC:0`; defines it with proj4 if new.
 * Identical (normalised) strings share one code.
 */
export function codeForSource(body: Body, def: string): string {
    const key = `${body.code}|${normaliseDef(def)}`;
    let code = codeForDef.get(key);
    if (code === undefined) {
        code = `${body.code}:SRC:${codeForDef.size}`;
        codeForDef.set(key, code);
        proj4.defs(code, normaliseDef(def));
    }
    return code;
}

/** Register all proj4 defs with OL, then set up the view projection. */
export function registerAll(view: ViewCrs): Projection {
    register(proj4);
    const proj = getProjection(view.code);
    if (!proj) throw new Error(`${view.code} is not defined (defineView)`);
    proj.setExtent(view.extent);
    proj.setGlobal(view.global);
    proj.setWorldExtent(view.worldExtent); // required by ol/layer/Graticule
    return proj;
}

/**
 * Source footprint in view coordinates, clipped to the view extent.
 *
 * Samples an (n+1)x(n+1) grid over the source bounds (edges included, so
 * curved outlines are followed) and keeps the samples that land inside the
 * view extent. Bounding the raw samples is not enough: a north-polar file in a
 * south-polar view projects to a ring *around* the view. If a pole lies
 * inside the source, the pole is added at all longitudes, since grid samples
 * miss it (e.g. a polar-stereo file shown in EQC spans the full top edge).
 *
 * @param bounds Source extent [minx, miny, maxx, maxy].
 * @param srcCode Registered proj4 code of the source CRS.
 * @param n Grid divisions per side.
 * @returns Extent in view coordinates, or null if no part of the source
 *   falls inside the view extent.
 */
export function footprintInView(
    bounds: Extent,
    srcCode: string,
    view: ViewCrs,
    n = 32,
): Extent | null {
    const toView = proj4(srcCode, view.code).forward;
    // Lon/lat -> CRS. Datum is WGS84 here, which is harmless: poles and
    // longitudes are unchanged by the geocentric datum step.
    const poleToSrc = proj4(srcCode).forward;
    const lonLatToView = proj4(view.code).forward;
    const [x0, y0, x1, y1] = bounds;
    const pts: Coordinate[] = [];
    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
            pts.push(
                toView([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n]),
            );
        }
    }
    for (const lat of [90, -90]) {
        const inSrc = poleToSrc([0, lat]);
        if (!inSrc.every(Number.isFinite) || !containsCoordinate(bounds, inSrc))
            continue;
        for (let lon = -180; lon <= 180; lon += 10) {
            pts.push(lonLatToView([lon, lat]));
        }
    }
    const inside = pts.filter(
        (p) => p.every(Number.isFinite) && containsCoordinate(view.extent, p),
    );
    if (!inside.length) return null;
    // Pad a little: samples can straddle the antimeridian seam or step over
    // curved edges, and the layer extent clips rendering.
    const ext = boundingExtent(inside);
    const pad = 0.03 * Math.max(getWidth(ext), getHeight(ext));
    return getIntersection(buffer(ext, pad), view.extent);
}
