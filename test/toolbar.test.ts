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
    const [min, max] = el.querySelectorAll("input");
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
        error,
    };
}

function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("change"));
}

function checkbox(toolbar: Toolbar): HTMLInputElement {
    const grid = toolbar.root.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
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
        expect(t.el.querySelector('input[type="checkbox"]')).toBeNull();
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
