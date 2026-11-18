import { describe, expect, it, vi } from "vitest";
import {
    DISPLAY,
    DisplayController,
    sourceInfo,
    validateDisplay,
} from "../src/display.js";
import type { DisplayState, MakeSource } from "../src/display.js";

const fakeLayer = () => ({
    setSource: vi.fn(),
    setStyle: vi.fn(),
    updateStyleVariables: vi.fn(),
});

describe("validateDisplay", () => {
    const ok = { ...DISPLAY, bands: [1] };

    it("accepts the defaults", () => {
        expect(validateDisplay(ok, 1)).toBeNull();
    });

    it.each([
        [{ min: NaN }, "min and max must be numbers"],
        [{ max: Infinity }, "min and max must be numbers"],
        [{ min: 5, max: 5 }, "max must be greater than min"],
        [{ scale: "sqrt" }, "scale must be one of"],
        [{ scale: "log", min: 0 }, "log scale needs min > 0"],
        [{ colormap: "jet" }, "colormap must be one of"],
        [{ bands: [1, 2] }, "bands must list 1 (gray) or 3 (RGB)"],
        [{ bands: "1" }, "bands must list 1 (gray) or 3 (RGB)"],
        [{ bands: [0] }, "band 0 is not in 1..3"],
        [{ bands: [4] }, "band 4 is not in 1..3"],
        [{ bands: [1.5] }, "band 1.5 is not in 1..3"],
    ])("rejects %o", (change, message) => {
        // Deliberately invalid values, as a JS caller could pass
        const d = { ...ok, ...change } as unknown as DisplayState;
        expect(validateDisplay(d, 3)).toContain(message);
    });
});

describe("sourceInfo", () => {
    it("reads only the displayed bands, in display order", () => {
        const display = { ...DISPLAY, bands: [4, 3, 2] };
        expect(sourceInfo("a.tif", display)).toEqual({
            url: "a.tif",
            bands: [4, 3, 2],
        });
    });

    it("passes nodata only when configured", () => {
        expect(sourceInfo("a.tif", { ...DISPLAY, nodata: 0 })).toEqual({
            url: "a.tif",
            bands: [1],
            nodata: 0,
        });
    });
});

describe("DisplayController", () => {
    function setup(display: Partial<DisplayState> = {}, bandCount = 15) {
        const controller = new DisplayController(display, bandCount);
        const layers = [fakeLayer(), fakeLayer()];
        // Each "source" records the state it was built for.
        layers.forEach((l, i) =>
            controller.addLayer(l, ((state: DisplayState) => ({
                layer: i,
                bands: state.bands,
            })) as unknown as MakeSource),
        );
        return { controller, layers };
    }

    it("throws on an invalid initial config", () => {
        expect(() => new DisplayController({ bands: [4] }, 1)).toThrow(
            "Invalid display config: band 4 is not in 1..1",
        );
    });

    it("only updates style variables for min/max changes", () => {
        const { controller, layers } = setup();
        expect(controller.update({ min: 10, max: 20 })).toBeNull();
        for (const layer of layers) {
            expect(layer.setSource).not.toHaveBeenCalled();
            expect(layer.setStyle).not.toHaveBeenCalled();
            expect(layer.updateStyleVariables).toHaveBeenCalledWith(
                expect.objectContaining({ min: 10, max: 20 }),
            );
        }
    });

    it("rebuilds each layer's source, not its style, for a new band number", () => {
        const { controller, layers } = setup();
        expect(controller.update({ bands: [7] })).toBeNull();
        layers.forEach((layer, i) => {
            expect(layer.setSource).toHaveBeenCalledWith({
                layer: i,
                bands: [7],
            });
            expect(layer.setStyle).not.toHaveBeenCalled();
        });
    });

    it("rebuilds source and style when switching gray -> RGB", () => {
        const { controller, layers } = setup();
        controller.update({ bands: [4, 3, 2] });
        expect(layers[0].setSource).toHaveBeenCalledTimes(1);
        expect(layers[0].setStyle).toHaveBeenCalledTimes(1);
    });

    it("stops updating a removed layer", () => {
        const { controller, layers } = setup();
        controller.removeLayer(layers[0]);
        controller.update({ min: 10 });
        expect(layers[0].updateStyleVariables).not.toHaveBeenCalled();
        expect(layers[1].updateStyleVariables).toHaveBeenCalled();
    });

    describe("setBandCount", () => {
        it("keeps bands that are still in range, and notifies", () => {
            const { controller, layers } = setup({ bands: [4, 3, 2] });
            const fn = vi.fn();
            controller.onChange(fn);
            controller.setBandCount(4);
            expect(controller.bandCount).toBe(4);
            expect(controller.state.bands).toEqual([4, 3, 2]);
            expect(fn).toHaveBeenCalledTimes(1);
            expect(layers[0].setSource).not.toHaveBeenCalled();
        });

        it.each([
            [[4, 3, 2], 3, [3, 3, 2]],
            [[4, 3, 2], 1, [1]], // RGB needs 3 bands
            [[7], 5, [5]],
        ])("clamps %j to %i bands -> %j", (bands, n, expected) => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            const { controller, layers } = setup({ bands });
            controller.setBandCount(n);
            expect(controller.state.bands).toEqual(expected);
            expect(layers[0].setSource).toHaveBeenCalledTimes(1);
            vi.restoreAllMocks();
        });

        it("rejects a non-positive count", () => {
            const { controller } = setup();
            expect(() => controller.setBandCount(0)).toThrow(
                "band count must be a positive integer",
            );
        });
    });

    it("stops updating layers after clearLayers", () => {
        const { controller, layers } = setup();
        controller.clearLayers();
        expect(controller.update({ min: 10, bands: [7] })).toBeNull();
        for (const layer of layers) {
            expect(layer.setSource).not.toHaveBeenCalled();
            expect(layer.updateStyleVariables).not.toHaveBeenCalled();
        }
    });

    it("keeps sources when the band numbers are unchanged", () => {
        const { controller, layers } = setup({ bands: [4, 3, 2] });
        controller.update({ bands: [4, 3, 2], colormap: "magma" });
        expect(layers[0].setSource).not.toHaveBeenCalled();
    });

    it.each<[string, Partial<DisplayState>]>([
        ["scale", { scale: "log", min: 1 }],
        ["colormap", { colormap: "magma" }],
    ])("rebuilds every layer's style on a %s change", (_, change) => {
        const { controller, layers } = setup();
        expect(controller.update(change)).toBeNull();
        for (const layer of layers) {
            expect(layer.setStyle).toHaveBeenCalledTimes(1);
        }
    });

    it("returns the error and leaves state and layers untouched on bad input", () => {
        const { controller, layers } = setup();
        const before = controller.state;
        expect(controller.update({ max: -1 })).toBe(
            "max must be greater than min",
        );
        expect(controller.state).toBe(before);
        expect(layers[0].updateStyleVariables).not.toHaveBeenCalled();
    });

    it("refuses to change nodata after build", () => {
        const { controller } = setup();
        expect(controller.update({ nodata: 0 })).toMatch(/nodata is fixed/);
    });

    it("notifies listeners after successful updates until unsubscribed", () => {
        const { controller } = setup();
        const listener = vi.fn();
        const unsubscribe = controller.onChange(listener);
        controller.update({ max: 100 });
        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ max: 100 }),
        );
        controller.update({ max: -100 }); // invalid: no notification
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        controller.update({ max: 200 });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("is not affected by later edits to the caller's bands array", () => {
        const bands = [4, 3, 2];
        const { controller } = setup({ bands });
        bands[0] = 99;
        expect(controller.state.bands).toEqual([4, 3, 2]);
        const change = [5, 6, 7];
        controller.update({ bands: change });
        change[0] = 99;
        expect(controller.state.bands).toEqual([5, 6, 7]);
    });
});
