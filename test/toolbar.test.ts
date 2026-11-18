// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DisplayController } from "../src/display.js";
import type { DisplayState, MakeSource } from "../src/display.js";
import { Toolbar } from "../src/controls/Toolbar.js";

const noSource = (() => ({})) as unknown as MakeSource;

function fakeGraticule(visible = false) {
    return { visible, getVisible: vi.fn(() => visible), setVisible: vi.fn() };
}

function setup(
    display: Partial<DisplayState> = { bands: [4, 3, 2], min: 0, max: 1 },
    bandCount = 15,
) {
    const controller = new DisplayController(display, bandCount);
    const layer = {
        setSource: vi.fn(),
        setStyle: vi.fn(),
        updateStyleVariables: vi.fn(),
    };
    controller.addLayer(layer, noSource);
    const toolbar = new Toolbar(controller);
    const el = toolbar.root;
    const [mode, r, g, b, scale, colormap] = el.querySelectorAll("select");
    const min = el.querySelector<HTMLInputElement>('input[title="Min"]')!;
    const max = el.querySelector<HTMLInputElement>('input[title="Max"]')!;
    const auto = el.querySelector<HTMLInputElement>(".mc-check input")!;
    const range = el.querySelector<HTMLElement>(".mc-range")!;
    const error = el.querySelector(".mc-error")!;
    return {
        controller,
        toolbar,
        el,
        mode,
        r,
        g,
        b,
        scale,
        colormap,
        min,
        max,
        auto,
        range,
        error,
    };
}

function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("change"));
}

function checkbox(toolbar: Toolbar): HTMLInputElement {
    const grid = toolbar.root.querySelector<HTMLInputElement>(
        'input[title="Show lon/lat grid"]',
    );
    if (!grid) throw new Error("no grid checkbox");
    return grid;
}

describe("Toolbar", () => {
    it("shows the initial state", () => {
        const t = setup();
        expect(t.mode.value).toBe("rgb");
        expect([t.r.value, t.g.value, t.b.value]).toEqual(["4", "3", "2"]);
        expect([t.min.value, t.max.value]).toEqual(["0", "1"]);
        expect(t.colormap.disabled).toBe(true); // RGB mode
    });

    it("offers band numbers 1..bandCount", () => {
        const t = setup();
        expect(t.r.options).toHaveLength(15);
        expect(t.r.options[14].value).toBe("15");
    });

    it("follows band-count changes (files added or removed)", () => {
        const t = setup({ bands: [2] });
        t.controller.setBandCount(2);
        expect(t.r.options).toHaveLength(2);
        expect(t.mode.options[1].disabled).toBe(true); // RGB needs 3 bands
        t.controller.setBandCount(15);
        expect(t.r.options).toHaveLength(15);
        expect(t.mode.options[1].disabled).toBe(false);
        expect(t.r.value).toBe("2");
    });

    it("offers a real RGB default once a 1-band file is replaced", () => {
        const t = setup({ bands: [1] }, 1);
        t.controller.setBandCount(15);
        change(t.mode, "rgb");
        expect(t.controller.state.bands).toEqual([3, 2, 1]);
    });

    describe("auto range", () => {
        it("is off when the config gives min/max: Min and Max are shown", () => {
            const t = setup(); // { min: 0, max: 1 }
            expect(t.auto.checked).toBe(false);
            expect(t.min.closest("label")!.hidden).toBe(false);
            expect(t.range.hidden).toBe(true);
        });

        it("is on by default: Min/Max hidden, the range shown instead", () => {
            const t = setup({ bands: [1] });
            expect(t.auto.checked).toBe(true);
            expect(t.min.closest("label")!.hidden).toBe(true);
            expect(t.max.closest("label")!.hidden).toBe(true);
            t.controller.update({ min: 0.123456789, max: 98.7654, auto: true });
            expect(t.range.textContent).toBe("0.1235 – 98.77");
        });

        it("doesn't send min/max while on", () => {
            const t = setup({ bands: [1] });
            expect(t.toolbar.readForm()).not.toHaveProperty("min");
            change(t.scale, "log"); // placeholder min > 0 until data arrives
            expect(t.controller.state).toMatchObject({
                scale: "log",
                auto: true,
            });
        });

        it("unchecking shows Min/Max pre-filled with the current range", () => {
            const t = setup({ bands: [1] });
            t.controller.update({ min: 12.3456789, max: 201, auto: true });
            t.auto.checked = false;
            t.auto.dispatchEvent(new Event("change"));
            expect(t.min.closest("label")!.hidden).toBe(false);
            expect([t.min.value, t.max.value]).toEqual(["12.3457", "201"]);
            expect(t.controller.state).toMatchObject({
                auto: false,
                min: 12.3457,
                max: 201,
            });
            // ... and editable
            change(t.max, "150");
            expect(t.controller.state).toMatchObject({ auto: false, max: 150 });
        });

        it("checking it again hands min/max back to the data", () => {
            const t = setup(); // auto off
            t.auto.checked = true;
            t.auto.dispatchEvent(new Event("change"));
            expect(t.controller.state.auto).toBe(true);
            expect(t.min.closest("label")!.hidden).toBe(true);
        });

        it("turns off when min/max are set from code", () => {
            const t = setup({ bands: [1] });
            t.controller.update({ max: 7 });
            expect(t.auto.checked).toBe(false);
            expect(t.max.value).toBe("7");
        });
    });

    it("switches to gray and back, remembering the RGB bands", () => {
        const t = setup();
        change(t.mode, "gray");
        expect(t.controller.state.bands).toEqual([1]);
        expect(t.g.hidden && t.b.hidden).toBe(true);
        expect(t.colormap.disabled).toBe(false);

        change(t.r, "7");
        change(t.colormap, "viridis");
        expect(t.controller.state).toMatchObject({
            bands: [7],
            colormap: "viridis",
        });

        change(t.mode, "rgb");
        expect(t.controller.state.bands).toEqual([4, 3, 2]);
    });

    it("applies min and max", () => {
        const t = setup();
        change(t.min, "0.2");
        change(t.max, "0.9");
        expect(t.controller.state).toMatchObject({ min: 0.2, max: 0.9 });
    });

    it("flags invalid input and keeps the last valid state", () => {
        const t = setup();
        change(t.min, "5"); // > max
        expect(t.error.textContent).toBe("max must be greater than min");
        expect(t.el.classList.contains("mc-has-error")).toBe(true);
        expect(t.controller.state.min).toBe(0);

        change(t.min, ""); // empty -> NaN
        expect(t.error.textContent).toBe("min and max must be numbers");

        change(t.min, "0.1");
        expect(t.error.textContent).toBe("");
        expect(t.el.classList.contains("mc-has-error")).toBe(false);
        expect(t.controller.state.min).toBe(0.1);
    });

    it("rejects log scale while min <= 0", () => {
        const t = setup();
        change(t.scale, "log");
        expect(t.error.textContent).toBe("log scale needs min > 0");
        expect(t.controller.state.scale).toBe("linear");
    });

    it("follows programmatic controller updates", () => {
        const t = setup();
        t.controller.update({ min: 0.3, scale: "log" });
        expect(t.min.value).toBe("0.3");
        expect(t.scale.value).toBe("log");
    });

    it("disables RGB when files have fewer than 3 bands", () => {
        const t = setup({ bands: [1] }, 1);
        expect(t.mode.options[1].disabled).toBe(true);
    });

    it("stops listening to the controller when disposed", () => {
        const t = setup();
        expect(t.controller.listeners.size).toBe(1);
        t.toolbar.dispose();
        expect(t.controller.listeners.size).toBe(0);
    });

    it("has no grid checkbox without a graticule layer", () => {
        const t = setup();
        expect(
            t.el.querySelector('input[title="Show lon/lat grid"]'),
        ).toBeNull();
    });

    it("toggles the graticule layer from the grid checkbox", () => {
        const controller = new DisplayController({}, 1);
        const graticule = fakeGraticule(false);
        const toolbar = new Toolbar(controller, { graticule });
        const grid = checkbox(toolbar);
        expect(grid.checked).toBe(false);
        grid.checked = true;
        grid.dispatchEvent(new Event("change"));
        expect(graticule.setVisible).toHaveBeenLastCalledWith(true);
        grid.checked = false;
        grid.dispatchEvent(new Event("change"));
        expect(graticule.setVisible).toHaveBeenLastCalledWith(false);
    });

    it("starts the checkbox from the layer's visibility", () => {
        const controller = new DisplayController({}, 1);
        const toolbar = new Toolbar(controller, {
            graticule: fakeGraticule(true),
        });
        expect(checkbox(toolbar).checked).toBe(true);
    });
});
