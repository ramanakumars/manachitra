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
