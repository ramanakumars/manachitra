// Planetary bodies. Radii in metres, IAU WGCCRE 2015 (a = equatorial,
// b = polar, R = mean). View CRSs use the reference ellipsoid (a, b); R is
// for reference only. Verify against pyproj (IAU_2015) before relying on them.

export interface Body {
    name: string;
    /** Short CRS prefix, e.g. "JUP" (never "EPSG"). */
    code: string;
    /** Equatorial radius (m). */
    a: number;
    /** Polar radius (m). */
    b: number;
    /** Mean radius (m), reference only. */
    R?: number;
}

/** A custom body: like Body, but `b` defaults to `a` (a sphere). */
export type CustomBody = Omit<Body, "b"> & { b?: number };

export const BODIES = {
    mercury: {
        name: "Mercury",
        code: "MER",
        a: 2440530,
        b: 2438260,
        R: 2439400,
    },
    venus: { name: "Venus", code: "VEN", a: 6051800, b: 6051800, R: 6051800 },
    moon: { name: "Moon", code: "MOON", a: 1737400, b: 1737400, R: 1737400 },
    mars: { name: "Mars", code: "MARS", a: 3396190, b: 3376200, R: 3389500 },
    jupiter: {
        name: "Jupiter",
        code: "JUP",
        a: 71492000,
        b: 66854000,
        R: 69911000,
    },
    saturn: {
        name: "Saturn",
        code: "SAT",
        a: 60268000,
        b: 54364000,
        R: 58232000,
    },
    uranus: {
        name: "Uranus",
        code: "URA",
        a: 25559000,
        b: 24973000,
        R: 25362000,
    },
    neptune: {
        name: "Neptune",
        code: "NEP",
        a: 24764000,
        b: 24341000,
        R: 24622000,
    },
} as const satisfies Record<string, Body>;

export type BodyName = keyof typeof BODIES;

/**
 * What getBody accepts. `string & {}` keeps editor completion for BodyName
 * while allowing any case.
 */
export type BodyRef = BodyName | (string & {}) | CustomBody;

/**
 * Resolve a body by name (case-insensitive) or accept a custom definition
 * `{ name, code, a, b }` (metres; `b` defaults to `a`, i.e. a sphere).
 */
export function getBody(body: BodyRef): Body {
    if (body && typeof body === "object") {
        const { name, code, a, b = a } = body;
        if (!name || !code || !(a > 0) || !(b > 0) || b > a) {
            throw new Error(
                "Custom body needs `name`, `code`, and radii `a` >= `b` > 0 (metres)",
            );
        }
        if (/^EPSG$/i.test(code)) throw new Error("Body code must not be EPSG");
        return { ...body, b };
    }
    const bodies: Readonly<Record<string, Body | undefined>> = BODIES;
    const found = bodies[String(body).toLowerCase()];
    if (!found) {
        throw new Error(
            `Unknown body "${body}". Known: ${Object.keys(BODIES).join(", ")}`,
        );
    }
    return found;
}

/** What a file's CRS says about its body (see readMeta). */
export interface Ellipsoid {
    /** Semi-major axis (m). */
    a: number;
    /** Semi-minor axis (m). */
    b: number;
    /** Ellipsoid/datum/GCS names from the GeoKey citations, e.g. "MARS". */
    names: string[];
}

/**
 * Radius tolerance for matching a file's ellipsoid to a body in BODIES.
 * Files use the IAU equatorial radius, the mean radius, or an older value
 * (the Jupiter aurora files have a = 71892 km, 0.6% above IAU 2015). Bodies
 * are further apart than this, except Uranus b vs Neptune a, which isn't
 * compared.
 */
const RADIUS_TOLERANCE = 0.01;

const near = (x: number, ref: number | undefined, tol: number) =>
    ref !== undefined && Math.abs(x - ref) <= tol * ref;

/** Whether a file with semi-major axis `a` can be on `body`. */
const radiusMatches = (a: number, body: Body, tol = RADIUS_TOLERANCE) =>
    near(a, body.a, tol) || near(a, body.R, tol);

/**
 * Identify the body a file is on from its CRS ellipsoid. Tries, in order:
 * 1. a BODIES name in the citations (e.g. "Ellipsoid = MARS", "D_Jupiter")
 *    whose radius roughly agrees (5%, so a mislabelled file isn't trusted);
 * 2. the BODIES entry whose equatorial or mean radius is within 1% of `a`;
 * 3. a custom body with the file's own ellipsoid, named after the citation
 *    (e.g. "Io"), coded `<NAME>_<a in km>` so different ellipsoids never
 *    share a CRS code.
 * The BODIES entry (reference ellipsoid), not the file's ellipsoid, is
 * returned in cases 1 and 2: the view always uses the body's reference
 * ellipsoid.
 */
export function detectBody({ a, b, names }: Ellipsoid): Body {
    const bodies = Object.values(BODIES) as Body[];
    for (const name of names) {
        const found = bodies.find(
            (body) =>
                new RegExp(`\\b${body.name}\\b`, "i").test(name) &&
                radiusMatches(a, body, 0.05),
        );
        if (found) return found;
    }
    let best: Body | undefined;
    let bestErr = Infinity;
    for (const body of bodies) {
        if (!radiusMatches(a, body)) continue;
        const err = Math.min(
            Math.abs(a - body.a) / body.a,
            body.R ? Math.abs(a - body.R) / body.R : Infinity,
        );
        if (err < bestErr) [best, bestErr] = [body, err];
    }
    if (best) return best;

    const name = names[0] || "Unknown body";
    const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "") || "BODY";
    return getBody({
        name,
        code: `${slug.slice(0, 8)}_${Math.round(a / 1000)}`,
        a,
        b: Math.min(a, b),
    });
}

/** Whether two bodies are the same (same code and radii). */
export const sameBody = (x: Body | null, y: Body | null): boolean =>
    x === y ||
    (x !== null &&
        y !== null &&
        x.code === y.code &&
        x.a === y.a &&
        x.b === y.b);
