import { describe, expect, it } from "vitest";
import { getBody } from "../src/bodies.js";
import { viewCrs } from "../src/projections.js";
import { formatLonLat, lonLatFormatter } from "../src/controls/LonLat.js";

const jupiter = getBody("jupiter");

describe("formatLonLat", () => {
    it("uses N/S and E/W instead of signs", () => {
        expect(formatLonLat([-56.784, 12.345])).toBe("12.35°N  56.78°W");
        expect(formatLonLat([170, -45])).toBe("45.00°S  170.00°E");
    });

    it("treats zero as north/east", () => {
        expect(formatLonLat([0, 0])).toBe("0.00°N  0.00°E");
    });
});

describe("lonLatFormatter", () => {
    it("shows the pole at the centre of a north-polar view", () => {
        const format = lonLatFormatter(viewCrs(jupiter, "npstere"), jupiter);
        expect(format([0, 0])).toBe("90.00°N  0.00°E");
    });

    it("matches PROJ for a north-polar stereographic point", () => {
        // cs2cs: (0, -24665000) on the Jupiter ellipsoid -> 0 E, 71.54 N
        const format = lonLatFormatter(viewCrs(jupiter, "npstere"), jupiter);
        expect(format([0, -24665000])).toBe("71.54°N  0.00°E");
    });

    it("gives longitude as x / a in EQC", () => {
        const format = lonLatFormatter(viewCrs(jupiter, "eqc"), jupiter);
        const x = (128.91 * Math.PI * jupiter.a) / 180;
        expect(format([x, 0])).toBe("0.00°N  128.91°E");
    });

    it("shows a placeholder outside the view extent", () => {
        const view = viewCrs(jupiter, "eqc");
        const format = lonLatFormatter(view, jupiter);
        expect(format([0, view.extent[3] * 1.01])).toBe("–");
        expect(format(undefined)).toBe("–");
    });

    it("shows a placeholder in the corners outside the Mollweide ellipse", () => {
        const view = viewCrs(jupiter, "moll");
        const format = lonLatFormatter(view, jupiter);
        const [, , x1, y1] = view.extent;
        expect(format([0.99 * x1, 0.99 * y1])).toBe("–");
        expect(format([0, 0])).toBe("0.00°N  0.00°E");
    });
});
