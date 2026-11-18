// Display toolbar (top right): mode (gray / RGB), band(s), min/max, scale,
// colormap, and an optional lon/lat grid toggle. Every edit submits the whole
// form to the DisplayController, so the form and the shared display state
// can't drift apart. Invalid input is flagged and the last valid state stays
// on screen.
import Control from "ol/control/Control.js";
import type BaseLayer from "ol/layer/Base.js";
import { COLORMAPS } from "../colormaps.js";
import type { ColormapName } from "../colormaps.js";
import { SCALES } from "../display.js";
import type { DisplayController, DisplayState, Scale } from "../display.js";
import { el, field, select } from "./dom.js";

/** Default RGB triple for a file with n bands (n >= 3). */
const defaultRgb = (n: number) => [3, 2, 1].map((b) => Math.min(b, n));

/** The layer the "Grid" checkbox toggles. */
export type ToggleableLayer = Pick<BaseLayer, "getVisible" | "setVisible">;

export interface ToolbarOptions {
    /** Layer toggled by the "Grid" checkbox (omit to hide the checkbox). */
    graticule?: ToggleableLayer;
    /** Element to render into (default: the map's control container). */
    target?: HTMLElement;
}

export class Toolbar extends Control {
    private readonly controller: DisplayController;
    /** The toolbar's DOM node (OL's `element`, which is protected and nullable). */
    readonly root: HTMLDivElement;
    private readonly unsubscribe: () => void;
    private lastGray: number[];
    private lastRgb: number[];
    private readonly mode: HTMLSelectElement;
    private readonly bands: HTMLSelectElement[];
    private readonly min: HTMLInputElement;
    private readonly max: HTMLInputElement;
    private readonly scale: HTMLSelectElement;
    private readonly colormap: HTMLSelectElement;
    private readonly error: HTMLDivElement;
    private readonly bandField: HTMLLabelElement;
    private readonly colormapField: HTMLLabelElement;
    private readonly grid?: HTMLInputElement;

    constructor(
        controller: DisplayController,
        { graticule, target }: ToolbarOptions = {},
    ) {
        const element = el("div", {
            className: "mc-toolbar ol-unselectable ol-control",
        });
        super({ element, target });
        this.root = element;
        this.controller = controller;

        const state = controller.state;
        this.lastGray = state.bands.length === 1 ? state.bands : [1];
        this.lastRgb =
            state.bands.length === 3
                ? state.bands
                : defaultRgb(controller.bandCount);

        this.mode = select(
            [
                ["gray", "Gray"],
                ["rgb", "RGB"],
            ],
            "Display mode",
        );
        // Options filled in by sync(): the band count changes with the files.
        this.bands = ["Red", "Green", "Blue"].map((c) =>
            select([], `${c} band`),
        );
        this.min = el("input", { type: "number", step: "any", title: "Min" });
        this.max = el("input", { type: "number", step: "any", title: "Max" });
        this.scale = select(SCALES, "Scaling");
        this.colormap = select(COLORMAPS, "Colormap");
        this.error = el("div", { className: "mc-error", role: "alert" });

        this.bandField = field("Band", ...this.bands);
        this.bandField.classList.add("mc-bands");
        this.colormapField = field("Colormap", this.colormap);
        element.append(
            field("Mode", this.mode),
            this.bandField,
            field("Min", this.min),
            field("Max", this.max),
            field("Scale", this.scale),
            this.colormapField,
        );
        if (graticule) {
            // Not display state: the grid is an overlay, not part of the stretch.
            const grid = el("input", {
                type: "checkbox",
                checked: graticule.getVisible(),
                title: "Show lon/lat grid",
            });
            grid.addEventListener("change", () =>
                graticule.setVisible(grid.checked),
            );
            this.grid = grid;
            element.append(field("Grid", grid));
        }
        element.append(this.error);

        this.mode.addEventListener("change", () => {
            const bands =
                this.mode.value === "rgb" ? this.lastRgb : this.lastGray;
            bands.forEach((b, i) => (this.bands[i].value = String(b)));
            this.submit();
        });
        for (const input of [
            ...this.bands,
            this.min,
            this.max,
            this.scale,
            this.colormap,
        ]) {
            input.addEventListener("change", () => this.submit());
        }

        this.sync(state);
        // Also reflects programmatic controller.update() calls.
        this.unsubscribe = controller.onChange((next) => this.sync(next));
    }

    /** Stop listening to the controller when OL disposes the control. */
    protected override disposeInternal(): void {
        this.unsubscribe();
        super.disposeInternal();
    }

    /** Read the form as a display-state change. */
    readForm(): Omit<DisplayState, "nodata"> {
        const count = this.mode.value === "rgb" ? 3 : 1;
        return {
            bands: this.bands.slice(0, count).map((s) => Number(s.value)),
            // NaN when empty or not a number; validateDisplay reports it
            min: this.min.valueAsNumber,
            max: this.max.valueAsNumber,
            // Option values come from SCALES / COLORMAPS; validated anyway
            scale: this.scale.value as Scale,
            colormap: this.colormap.value as ColormapName,
        };
    }

    /** Send the form to the controller and show any validation error. */
    submit(): void {
        const error = this.controller.update(this.readForm());
        this.error.textContent = error ?? "";
        this.root.classList.toggle("mc-has-error", Boolean(error));
    }

    /** Offer band numbers 1..bandCount (rebuilt only when the count changes). */
    private syncBandOptions(): void {
        const n = this.controller.bandCount;
        // RGB needs three distinct bands to be meaningful
        this.mode.options[1].disabled = n < 3;
        if (this.bands[0].options.length === n) return;
        for (const s of this.bands) {
            s.replaceChildren(
                ...Array.from({ length: n }, (_, i) =>
                    el("option", {
                        value: String(i + 1),
                        textContent: String(i + 1),
                    }),
                ),
            );
        }
        // Remembered bands may be out of range (their file is gone), or a
        // placeholder from when fewer than 3 bands existed (e.g. [1, 1, 1]).
        if (this.lastGray[0] > n) this.lastGray = [1];
        const rgb = this.lastRgb;
        if (rgb.some((b) => b > n) || new Set(rgb).size < Math.min(3, n)) {
            this.lastRgb = defaultRgb(n);
        }
    }

    /** Show a display state in the form. */
    sync(state: Readonly<DisplayState>): void {
        this.syncBandOptions();
        const rgb = state.bands.length === 3;
        if (rgb) this.lastRgb = state.bands;
        else this.lastGray = state.bands;
        this.mode.value = rgb ? "rgb" : "gray";
        state.bands.forEach((b, i) => (this.bands[i].value = String(b)));
        this.bands.forEach((s, i) => (s.hidden = !rgb && i > 0));
        this.bandField.querySelector(".mc-label")!.textContent = rgb
            ? "R G B"
            : "Band";
        this.min.value = String(state.min);
        this.max.value = String(state.max);
        this.scale.value = state.scale;
        this.colormap.value = state.colormap;
        this.colormap.disabled = rgb; // colormaps apply to gray mode only
        this.colormapField.classList.toggle("mc-disabled", rgb);
    }
}
