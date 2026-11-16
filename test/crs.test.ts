import { beforeAll, describe, expect, it } from "vitest";
import { getHeight, getWidth } from "ol/extent.js";
import { getBody } from "../src/bodies.js";
import { viewCrs } from "../src/projections.js";
import {
    codeForSource,
    defineView,
    footprintInView,
    normaliseDef,
    registerAll,
} from "../src/crs.js";
import type { Extent } from "ol/extent.js";
import type { DisplayController } from "../src/display.js";
import { createLayer } from "../src/layers.js";
import type { SourceMeta } from "../src/metadata.js";

// CRSs and bounds of the sample files in public/, as read by geotiff.js.
const AURORA = {
    def: "+proj=stere +lat_0=90 +k_0=1 +x_0=0 +y_0=0 +a=71892000 +b=67251000 +no_defs",
    bounds: [
        -53608938.856164254, -54160211.71888593, 53591061.143835746,
        53539788.28111407,
    ],
};
const GRS = {
    def: "+proj=laea +lat_0=-19.458999633789 +lon_0=-66.09375 +x_0=0 +y_0=0 +a=71492000 +b=66854000.000000015 +no_defs",
    bounds: [-8000000, -8000000, 8000000, 8000000],
};

const jupiter = getBody("jupiter");
const views = Object.fromEntries(
    ["eqc", "moll", "npstere", "spstere"].map((p) => [p, viewCrs(jupiter, p)]),
);
let auroraCode: string;
let grsCode: string;

beforeAll(() => {
    Object.values(views).forEach(defineView);
    auroraCode = codeForSource(jupiter, AURORA.def);
    grsCode = codeForSource(jupiter, GRS.def);
    Object.values(views).forEach(registerAll);
});

describe("normaliseDef", () => {
    it("collapses whitespace and appends metre units", () => {
        expect(normaliseDef("  +proj=laea   +lat_0=1 \n")).toBe(
            "+proj=laea +lat_0=1 +units=m",
        );
    });

    it("keeps explicit units", () => {
        expect(normaliseDef("+proj=laea +units=km")).toBe(
            "+proj=laea +units=km",
        );
    });
});

describe("codeForSource", () => {
    it("gives identical CRSs (up to whitespace) one code", () => {
        const spaced = GRS.def.replaceAll(" ", "   ");
        expect(codeForSource(jupiter, spaced)).toBe(grsCode);
    });

    it("gives different CRSs different JUP:SRC codes", () => {
        expect(auroraCode).toMatch(/^JUP:SRC:\d+$/);
        expect(grsCode).toMatch(/^JUP:SRC:\d+$/);
        expect(auroraCode).not.toBe(grsCode);
    });
});

describe("registerAll", () => {
    it("sets the view projection's extent and wrap flag", () => {
        const proj = registerAll(views.eqc);
        expect(proj.getExtent()).toEqual(views.eqc.extent);
        expect(proj.isGlobal()).toBe(true);
        expect(proj.getWorldExtent()).toEqual([-180, -90, 180, 90]);
        expect(registerAll(views.moll).isGlobal()).toBe(false);
    });
});

/** footprintInView, failing the test if the source is outside the view. */
function footprint(...args: Parameters<typeof footprintInView>): Extent {
    const ext = footprintInView(...args);
    if (!ext) throw new Error("expected a footprint, got null");
    return ext;
}

describe("footprintInView", () => {
    it("covers the pole and the full width for a polar file in EQC", () => {
        const [x0, , x1, y1] = footprint(AURORA.bounds, auroraCode, views.eqc);
        expect(y1).toBeCloseTo(views.eqc.extent[3], 0); // north pole edge
        expect(x0).toBeCloseTo(views.eqc.extent[0], 0);
        expect(x1).toBeCloseTo(views.eqc.extent[2], 0);
    });

    it("stays within the view extent", () => {
        const ext = footprint(AURORA.bounds, auroraCode, views.npstere);
        const [vx0, vy0, vx1, vy1] = views.npstere.extent;
        expect(ext[0]).toBeGreaterThanOrEqual(vx0);
        expect(ext[1]).toBeGreaterThanOrEqual(vy0);
        expect(ext[2]).toBeLessThanOrEqual(vx1);
        expect(ext[3]).toBeLessThanOrEqual(vy1);
    });

    it("is a small box for a small LAEA tile", () => {
        const ext = footprint(GRS.bounds, grsCode, views.eqc);
        // 16000 km tile: a few tens of thousands of km in EQC at ~20 deg S
        expect(getWidth(ext)).toBeGreaterThan(10e6);
        expect(getWidth(ext)).toBeLessThan(40e6);
        expect(getHeight(ext)).toBeLessThan(40e6);
        expect(ext[3]).toBeLessThan(0); // southern hemisphere
    });

    it("returns null for a file in the opposite polar hemisphere", () => {
        // The aurora projects to a ring around the south-polar view.
        expect(footprintInView(AURORA.bounds, auroraCode, views.spstere)).toBe(
            null,
        );
        expect(footprintInView(GRS.bounds, grsCode, views.npstere)).toBe(null);
    });
});

describe("createLayer", () => {
    it("skips files that are entirely outside the view", () => {
        const fileMeta = {
            ...GRS,
            code: grsCode,
            url: "x/GRS.tif",
        } as SourceMeta;
        // Returns before touching the controller
        const noController = null as unknown as DisplayController;
        expect(createLayer(fileMeta, views.npstere, noController)).toBe(null);
    });
});
