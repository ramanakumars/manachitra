import { describe, expect, it } from "vitest";
import proj4 from "proj4";
import { createGraticule, formatDegrees } from "../src/graticule.js";
import { getBody } from "../src/bodies.js";
import { ellipsoid, viewCrs } from "../src/projections.js";

describe("formatDegrees", () => {
    it.each([
        [30, "30°N"],
        [-45, "45°S"],
        [0, "0°"],
        [0.5, "0.5°N"],
        [-1 / 60, "0.0167°S"],
        [10.0000001, "10°N"],
    ])("formats %s as %s", (deg, text) => {
        expect(formatDegrees(deg, "N", "S")).toBe(text);
    });
});

describe("createGraticule", () => {
    it("starts hidden unless asked", () => {
        expect(createGraticule().getVisible()).toBe(false);
        expect(createGraticule({ visible: true }).getVisible()).toBe(true);
    });
});

describe("EPSG:4326 as body lon/lat", () => {
    // OL's Graticule computes lines in EPSG:4326. They must land on the body's
    // lon/lat, and -- what actually matters -- the distance between grid lines
    // must be the distance on the body. Reference distances: PROJ `geod -I`
    // on the Jupiter ellipsoid (+a=71492000 +b=66854000). Earth's would be
    // ~111 km per degree.
    const jupiter = getBody("jupiter");
    const geo = `+proj=longlat ${ellipsoid(jupiter)} +no_defs`;

    it.each(["eqc", "moll", "npstere"])(
        "places grid lines at the right lon/lat in %s",
        (name) => {
            const view = viewCrs(jupiter, name);
            for (const lonLat of [
                [0, 30],
                [45, 60],
                [-120, 89],
            ]) {
                const xy = proj4("EPSG:4326", view.def).forward(lonLat);
                const back = proj4(geo, view.def).inverse(xy);
                expect(back[0]).toBeCloseTo(lonLat[0], 9);
                expect(back[1]).toBeCloseTo(lonLat[1], 9);
            }
        },
    );

    it.each([
        ["eqc", [0, 0], [0, 1], 1091.146], // meridian at the equator
        ["eqc", [0, 60], [0, 61], 1267.571], // meridian at 60 N
        ["eqc", [0, 0], [1, 0], 1247.771], // along the equator
        ["npstere", [0, 89], [0, 90], 1334.306], // into the pole
        ["npstere", [0, 89.9], [180, 89.9], 266.867], // across the pole
    ])(
        "spaces %s grid lines %j -> %j by Jupiter's %s km",
        (name, from, to, km) => {
            const toView = proj4("EPSG:4326", viewCrs(jupiter, name).def);
            const [x0, y0] = toView.forward(from);
            const [x1, y1] = toView.forward(to);
            const distance = Math.hypot(x1 - x0, y1 - y0) / 1000;
            // Residual is the projection's own scale factor (<= 25 ppm here)
            expect(Math.abs(distance / km - 1)).toBeLessThan(1e-4);
        },
    );
});
