// View projections, keyed by the name passed to buildMap({ projection }).
// Every projection is on the body's reference ellipsoid (+a/+b). proj4js
// treats eqc and stere ellipsoidally; moll is spherical-only (scales by a,
// ignores b). So extents are computed by projecting sample points rather than
// with closed-form formulas.
//   global: true lets OL wrap the world horizontally (only valid for
//   cylindrical projections).
//   worldExtent: [minLon, minLat, maxLon, maxLat] the view covers; OL's
//   Graticule needs it to know which meridians/parallels to draw.
import proj4 from "proj4";
import type { Extent } from "ol/extent.js";
import type { Body } from "./bodies.js";

/** Lon/lat (degrees) -> projected coordinates (m). */
type Forward = (lonLat: number[]) => number[];

export interface ProjectionDef {
    label: string;
    /** proj4 string without ellipsoid or units. */
    proj: string;
    /** Full projection extent, from a lon/lat -> view transform. */
    extent: (fwd: Forward) => Extent;
    global: boolean;
    worldExtent: Extent;
}

const square = (r: number): Extent => [-r, -r, r, r];

export const PROJECTIONS = {
    eqc: {
        label: "Equirectangular",
        proj: "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0",
        // x from the antimeridian, y from the pole (meridian arc length)
        extent: (fwd) => {
            const [x] = fwd([180, 0]);
            const [, y] = fwd([0, 90]);
            return [-x, -y, x, y];
        },
        global: true,
        worldExtent: [-180, -90, 180, 90],
    },
    moll: {
        label: "Mollweide",
        proj: "+proj=moll +lon_0=0 +x_0=0 +y_0=0",
        extent: (fwd) => {
            const [x] = fwd([180, 0]);
            const [, y] = fwd([0, 90]);
            return [-x, -y, x, y];
        },
        global: false,
        worldExtent: [-180, -90, 180, 90],
    },
    // Polar stereographic, true scale at the pole; extent reaches the equator.
    npstere: {
        label: "North polar stereographic",
        proj: "+proj=stere +lat_0=90 +lon_0=0 +k_0=1 +x_0=0 +y_0=0",
        extent: (fwd) => square(Math.hypot(...fwd([0, 0]))),
        global: false,
        worldExtent: [-180, 0, 180, 90],
    },
    spstere: {
        label: "South polar stereographic",
        proj: "+proj=stere +lat_0=-90 +lon_0=0 +k_0=1 +x_0=0 +y_0=0",
        extent: (fwd) => square(Math.hypot(...fwd([0, 0]))),
        global: false,
        worldExtent: [-180, -90, 180, 0],
    },
} satisfies Record<string, ProjectionDef>;

export type ProjectionName = keyof typeof PROJECTIONS;

/** What viewCrs accepts (any case; `string & {}` keeps completion). */
export type ProjectionRef = ProjectionName | (string & {});

export interface ViewCrs {
    /** e.g. "JUP:EQC". */
    code: string;
    /** proj4 string on the body ellipsoid. */
    def: string;
    /** Full projection extent (m). */
    extent: Extent;
    /** Whether OL may wrap the world horizontally. */
    global: boolean;
    /** Lon/lat range covered (degrees). */
    worldExtent: Extent;
}

/** proj4 ellipsoid parameters for a body. */
export const ellipsoid = (body: Body): string => `+a=${body.a} +b=${body.b}`;

/**
 * Build the view CRS for a body: `{ code, def, extent, global, worldExtent }`.
 * Code is e.g. `JUP:EQC` (never `EPSG:`).
 * @param name Key of PROJECTIONS (case-insensitive).
 */
export function viewCrs(body: Body, name: ProjectionRef): ViewCrs {
    const key = String(name).toLowerCase();
    const projections: Record<string, ProjectionDef | undefined> = PROJECTIONS;
    const p = projections[key];
    if (!p) {
        throw new Error(
            `Unknown projection "${name}". Known: ${Object.keys(PROJECTIONS).join(", ")}`,
        );
    }
    const def = `${p.proj} ${ellipsoid(body)} +units=m +no_defs`;
    // Geographic CRS on the same ellipsoid, so no datum step. Passed as a string
    // only: registering a longlat def would give OL an Earth-based metersPerUnit.
    const geo = `+proj=longlat ${ellipsoid(body)} +no_defs`;
    const fwd: Forward = proj4(geo, def).forward;
    return {
        code: `${body.code}:${key.toUpperCase()}`,
        def,
        extent: p.extent(fwd),
        global: p.global,
        worldExtent: p.worldExtent,
    };
}
