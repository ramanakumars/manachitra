import { describe, expect, it } from "vitest";
import {
    COLORMAP_STOPS,
    COLORMAPS,
    palette,
    PALETTE_SIZE,
} from "../src/colormaps.js";

describe("palette", () => {
    it.each(COLORMAPS)("expands %s to %i opaque RGBA colours", (name) => {
        const colors = palette(name);
        expect(colors).toHaveLength(PALETTE_SIZE);
        for (const [r, g, b, a] of colors) {
            for (const c of [r, g, b]) {
                expect(Number.isInteger(c) && c >= 0 && c <= 255).toBe(true);
            }
            expect(a).toBe(1);
        }
    });

    it.each(COLORMAPS)("starts and ends on the %s stops", (name) => {
        const stops = COLORMAP_STOPS[name];
        const colors = palette(name);
        expect(colors[0].slice(0, 3)).toEqual(stops[0]);
        expect(colors.at(-1)?.slice(0, 3)).toEqual(stops.at(-1));
    });

    it("runs from black to white for gray", () => {
        const colors = palette("gray");
        expect(colors[0]).toEqual([0, 0, 0, 1]);
        expect(colors.at(-1)).toEqual([255, 255, 255, 1]);
    });

    it("throws for an unknown colormap, listing the known ones", () => {
        expect(() => palette("jet")).toThrow(/Unknown colormap "jet".*viridis/);
    });
});
