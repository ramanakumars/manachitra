import { describe, expect, it } from "vitest";
import { buildStyle, LOG_STOPS, styleVariables } from "../src/style.js";
import { palette } from "../src/colormaps.js";
import type { DisplayState } from "../src/display.js";
import { evaluate } from "./helpers/evaluate.js";

const gray: DisplayState = {
    bands: [1],
    min: 0,
    max: 500,
    scale: "linear",
    colormap: "gray",
};

/**
 * Colour for one pixel under a display state. `bands` are OUTPUT band values:
 * the source reads only the displayed file bands, in display order.
 */
function colorOf(state: DisplayState, bands: number[]) {
    const style = buildStyle(state);
    return evaluate(style.color, { bands, vars: varsOf(style) });
}

/** buildStyle always sets numeric variables. */
function varsOf(style: ReturnType<typeof buildStyle>) {
    return style.variables as Record<string, number>;
}

describe("styleVariables", () => {
    it("spaces log stops geometrically from min to max", () => {
        const vars = styleVariables({
            ...gray,
            scale: "log",
            min: 1,
            max: 1e4,
        });
        expect(vars.s0).toBeCloseTo(1);
        expect(vars[`s${LOG_STOPS}`]).toBeCloseTo(1e4);
        expect(vars[`s${LOG_STOPS / 2}`]).toBeCloseTo(100); // geometric mean
    });

    it("keeps log stops increasing even when log is not usable", () => {
        const vars = styleVariables({ ...gray, scale: "log", min: 0 });
        expect(vars.s1).toBeGreaterThan(vars.s0);
    });
});

describe("buildStyle: gray mode, linear", () => {
    it("maps min to the first and max to the last palette colour", () => {
        const colors = palette("gray");
        expect(colorOf(gray, [0])).toEqual(colors[0]);
        expect(colorOf(gray, [500])).toEqual(colors[255]);
    });

    it("maps the midpoint to the middle of the palette", () => {
        // t = 0.5 -> index 127.5 -> nearest entry 128
        expect(colorOf(gray, [250])).toEqual(palette("gray")[128]);
    });

    it("clamps values outside [min, max]", () => {
        const colors = palette("gray");
        expect(colorOf(gray, [-100])).toEqual(colors[0]);
        expect(colorOf(gray, [9999])).toEqual(colors[255]);
    });

    it("uses the selected colormap", () => {
        const state: DisplayState = { ...gray, colormap: "viridis" };
        expect(colorOf(state, [500])).toEqual(palette("viridis")[255]);
    });

    it("reads output band 1 whatever file band is selected", () => {
        const state = { ...gray, bands: [7] };
        expect(colorOf(state, [500])).toEqual(palette("gray")[255]);
    });
});

describe("buildStyle: log scale", () => {
    const log: DisplayState = { ...gray, scale: "log", min: 1, max: 1000 };

    it("puts the geometric mean of min and max at mid-palette", () => {
        const midpoint = Math.sqrt(1 * 1000);
        expect(colorOf(log, [midpoint])).toEqual(palette("gray")[128]);
    });

    it("approximates log(v/min)/log(max/min) to well under one palette step", () => {
        const style = buildStyle({ ...log, bands: [1, 1, 1] });
        for (const v of [1.5, 3, 10, 42, 99, 400, 999]) {
            const [t] = evaluate(style.color, {
                bands: [v],
                vars: varsOf(style),
            }) as number[];
            const exact = Math.log(v / 1) / Math.log(1000 / 1);
            expect(Math.abs(t - exact)).toBeLessThan(0.5 / 255);
        }
    });
});

describe("buildStyle: RGB mode", () => {
    const rgb = { ...gray, bands: [3, 2, 1], min: 0, max: 1 };

    it("stretches output bands 1..3 into red, green and blue", () => {
        expect(colorOf(rgb, [1, 0.5, 0.25])).toEqual([1, 0.5, 0.25, 1]);
    });
});
