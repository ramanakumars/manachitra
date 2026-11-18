import { describe, expect, it } from "vitest";
import { BODIES, detectBody, getBody, sameBody } from "../src/bodies.js";
import type { CustomBody } from "../src/bodies.js";
import { ellipsoid, PROJECTIONS, viewCrs } from "../src/projections.js";

describe("getBody", () => {
    it("looks up bodies case-insensitively", () => {
        expect(getBody("Jupiter")).toBe(BODIES.jupiter);
    });

    it("lists the known bodies for an unknown name", () => {
        expect(() => getBody("pluto")).toThrow(/Unknown body "pluto".*jupiter/);
    });

    it("accepts a custom body and defaults b to a (sphere)", () => {
        expect(getBody({ name: "Ball", code: "BALL", a: 1000 })).toEqual({
            name: "Ball",
            code: "BALL",
            a: 1000,
            b: 1000,
        });
    });

    it.each<[object, string]>([
        [{ code: "X", a: 1 }, "missing name"],
        [{ name: "X", a: 1 }, "missing code"],
        [{ name: "X", code: "X", a: 0 }, "a = 0"],
        [{ name: "X", code: "X", a: 1, b: 2 }, "b > a"],
    ])("rejects a custom body with %o (%s)", (body) => {
        expect(() => getBody(body as CustomBody)).toThrow(/Custom body needs/);
    });

    it("rejects EPSG as a body code", () => {
        expect(() => getBody({ name: "X", code: "epsg", a: 1 })).toThrow(
            /must not be EPSG/,
        );
    });
});

describe("viewCrs", () => {
    const jupiter = getBody("jupiter");

    it("builds the code and an ellipsoidal proj string", () => {
        const view = viewCrs(jupiter, "EQC");
        expect(view.code).toBe("JUP:EQC");
        expect(view.def).toContain("+proj=eqc");
        expect(view.def).toContain(ellipsoid(jupiter));
        expect(view.def).toContain("+units=m");
        expect(view.def).not.toContain("+R=");
    });

    it("lists the known projections for an unknown name", () => {
        expect(() => viewCrs(jupiter, "lcc")).toThrow(
            /Unknown projection "lcc".*moll/,
        );
    });

    // Reference values from PROJ cs2cs on the Jupiter ellipsoid
    // (a = 71492000, b = 66854000), except EQC y: proj4js uses the meridian
    // arc length there, PROJ uses a * lat (see CLAUDE.md, Known gotchas).
    it.each([
        ["eqc", 224598742.0, 108687252.1],
        ["moll", 202209912.0, 101104956.0],
        ["npstere", 134099030.7, 134099030.7],
        ["spstere", 134099030.7, 134099030.7],
    ])("gives the full %s extent", (name, x, y) => {
        const [x0, y0, x1, y1] = viewCrs(jupiter, name).extent;
        expect(x1).toBeCloseTo(x, 0);
        expect(y1).toBeCloseTo(y, 0);
        expect(x0).toBeCloseTo(-x, 0);
        expect(y0).toBeCloseTo(-y, 0);
    });

    it.each([
        ["eqc", Math.PI * 1000, (Math.PI / 2) * 1000],
        ["moll", 2 * Math.SQRT2 * 1000, Math.SQRT2 * 1000],
        ["npstere", 2000, 2000],
    ])("matches the closed-form %s extent on a sphere", (name, x, y) => {
        const ball = getBody({ name: "Ball", code: "BALL", a: 1000 });
        const [, , x1, y1] = viewCrs(ball, name).extent;
        expect(x1).toBeCloseTo(x, 6);
        expect(y1).toBeCloseTo(y, 6);
    });

    it.each([
        ["eqc", [-180, -90, 180, 90]],
        ["moll", [-180, -90, 180, 90]],
        ["npstere", [-180, 0, 180, 90]],
        ["spstere", [-180, -90, 180, 0]],
    ])("declares the lon/lat range %s covers", (name, worldExtent) => {
        expect(viewCrs(jupiter, name).worldExtent).toEqual(worldExtent);
    });

    it("only lets cylindrical projections wrap", () => {
        const global = Object.keys(PROJECTIONS).filter(
            (p) => viewCrs(jupiter, p).global,
        );
        expect(global).toEqual(["eqc"]);
    });
});

describe("detectBody", () => {
    const sphere = (a: number, names: string[] = []) => ({ a, b: a, names });

    it.each([
        // GRS tiles: IAU ellipsoid, "Ellipsoid = Jupiter"
        [{ a: 71492000, b: 66854000, names: ["Jupiter"] }, "jupiter"],
        // aurora: older radius, 0.6% above IAU 2015
        [{ a: 71892000, b: 67251000, names: ["Jupiter"] }, "jupiter"],
        // Jezero CTX mosaic: Mars sphere, "MARS" / "D_MARS" citations
        [sphere(3396190, ["MARS", "D MARS"]), "mars"],
    ] as const)("finds the body named in the citations (%#)", (e, key) => {
        expect(detectBody({ ...e, names: [...e.names] })).toBe(BODIES[key]);
    });

    it("matches by radius when no name is recognised", () => {
        expect(detectBody(sphere(3396190))).toBe(BODIES.mars);
        // mean-radius spheres count too
        expect(detectBody(sphere(69911000, ["GCS Unknown"]))).toBe(
            BODIES.jupiter,
        );
        expect(detectBody(sphere(1737400, ["Moon 2000"]))).toBe(BODIES.moon);
    });

    it("doesn't trust a name whose radius is far off", () => {
        const b = detectBody(sphere(1821600, ["Mars-ish"]));
        expect(b).not.toBe(BODIES.mars);
    });

    it("tells Uranus and Neptune apart by radius", () => {
        expect(detectBody(sphere(25559000))).toBe(BODIES.uranus);
        expect(detectBody(sphere(24764000))).toBe(BODIES.neptune);
    });

    it("makes a custom body from an unknown ellipsoid", () => {
        const io = detectBody({ a: 1821600, b: 1821600, names: ["Io"] });
        expect(io).toEqual({
            name: "Io",
            code: "IO_1822",
            a: 1821600,
            b: 1821600,
        });
        const unnamed = detectBody(sphere(500000));
        expect(unnamed).toMatchObject({
            name: "Unknown body",
            code: "UNKNOWNB_500",
        });
    });
});

describe("sameBody", () => {
    it("compares code and radii, not identity", () => {
        expect(sameBody(BODIES.mars, { ...BODIES.mars })).toBe(true);
        expect(sameBody(BODIES.mars, BODIES.jupiter)).toBe(false);
        expect(sameBody(null, null)).toBe(true);
        expect(sameBody(null, BODIES.mars)).toBe(false);
    });
});
