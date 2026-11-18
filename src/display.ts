// One display state shared by every layer, so tiles stretch identically
// (no seams between files).
//   bands    : FILE band numbers to show (1-based); 1 band = gray (colormap
//              applies), 3 bands = RGB. Only these bands are read, so
//              changing them rebuilds each layer's source (refetches tiles).
//   min/max  : stretch limits (numbers, same for every band shown).
//   auto     : min/max come from the data (AutoRange: percentiles of the
//              visible files' samples) instead of the user. On by default;
//              giving min or max (option, toolbar, update()) turns it off.
//   scale    : "linear" | "log" (log needs min > 0).
//   colormap : name from COLORMAPS (gray mode only).
//   nodata   : optional override of the files' GDAL nodata value(s).
import type WebGLTileLayer from "ol/layer/WebGLTile.js";
import type GeoTIFF from "ol/source/GeoTIFF.js";
import type { SourceInfo } from "ol/source/GeoTIFF.js";
import { COLORMAPS } from "./colormaps.js";
import type { ColormapName } from "./colormaps.js";
import { buildStyle, styleVariables } from "./style.js";

export const SCALES = ["linear", "log"] as const;
export type Scale = (typeof SCALES)[number];

/** Most bands a TIFF can hold (SamplesPerPixel is 16-bit). */
export const MAX_BANDS = 65535;

export interface DisplayState {
    /** 1 (gray) or 3 (RGB) FILE band numbers, 1-based. */
    bands: number[];
    min: number;
    max: number;
    /** min/max set from the data (AutoRange) rather than by the user. */
    auto: boolean;
    scale: Scale;
    colormap: ColormapName;
    /** Override of the files' GDAL nodata value(s). */
    nodata?: number | number[];
}

/** Defaults. min/max are placeholders until the auto range arrives. */
export const DISPLAY: Readonly<DisplayState> = {
    bands: [1],
    min: 0,
    max: 500,
    auto: true,
    scale: "linear",
    colormap: "gray",
    nodata: undefined,
};

/** The layer methods the controller drives (WebGLTileLayer in practice). */
export type DisplayLayer = Pick<
    WebGLTileLayer,
    "setSource" | "setStyle" | "updateStyleVariables"
>;

/** Builds a layer's source for a state (used when band numbers change). */
export type MakeSource = (state: DisplayState) => GeoTIFF;

/**
 * Check a display state. Values are checked at runtime too, since JS callers
 * and the toolbar form can pass anything.
 * @param bandCount Bands available in every file.
 * @returns Error message, or null if valid.
 */
export function validateDisplay(
    d: DisplayState,
    bandCount: number,
): string | null {
    if (!Number.isFinite(d.min) || !Number.isFinite(d.max)) {
        return "min and max must be numbers";
    }
    if (!(d.max > d.min)) return "max must be greater than min";
    if (typeof d.auto !== "boolean") return "auto must be true or false";
    if (!SCALES.includes(d.scale)) return `scale must be one of ${SCALES}`;
    if (d.scale === "log" && !(d.min > 0)) return "log scale needs min > 0";
    if (!COLORMAPS.includes(d.colormap)) {
        return `colormap must be one of ${COLORMAPS.join(", ")}`;
    }
    if (!Array.isArray(d.bands) || ![1, 3].includes(d.bands.length)) {
        return "bands must list 1 (gray) or 3 (RGB) band numbers";
    }
    const bad = d.bands.find(
        (b) => !Number.isInteger(b) || b < 1 || b > bandCount,
    );
    if (bad !== undefined) return `band ${bad} is not in 1..${bandCount}`;
    return null;
}

/**
 * SourceInfo for ol/source/GeoTIFF: reads only the displayed bands, in
 * display order (OUTPUT band i = display.bands[i - 1]). Reading every band
 * would need ceil(bands / 4) textures per tile and overflow WebGL's texture
 * unit limit (16-32) for files with more than ~60 bands.
 */
export function sourceInfo(url: string, display: DisplayState): SourceInfo {
    const info: SourceInfo = { url, bands: [...display.bands] };
    if (display.nodata !== undefined) info.nodata = display.nodata;
    return info;
}

// Copy `bands` so later edits to the caller's array can't change the state.
const withOwnBands = (d: DisplayState): DisplayState => ({
    ...d,
    bands: Array.isArray(d.bands) ? [...d.bands] : d.bands,
});

/**
 * The state a change leads to. Giving min or max without `auto` means the
 * user picked a range, so auto turns off. With auto on, a log scale gets a
 * positive placeholder min (the auto range, positive-only, replaces it).
 */
function nextState(
    current: DisplayState,
    changes: Partial<DisplayState>,
): DisplayState {
    const explicitRange =
        changes.min !== undefined || changes.max !== undefined;
    const next = withOwnBands({
        ...current,
        ...changes,
        auto: changes.auto ?? (explicitRange ? false : current.auto),
    });
    if (next.auto && next.scale === "log" && !(next.min > 0)) {
        next.min = next.max > 0 ? next.max / 1000 : 1e-3;
        if (!(next.max > next.min)) next.max = next.min * 1000;
    }
    return next;
}

/** The state a `display` option leads to (DISPLAY plus overrides). */
export const initialDisplay = (
    display: Partial<DisplayState> = {},
): DisplayState => nextState(DISPLAY, display);

const sameBands = (a: number[], b: number[]) =>
    a.length === b.length && a.every((band, i) => band === b[i]);

/**
 * Holds the shared display state and applies changes to every layer:
 * min/max changes update style variables (cheap); scale, colormap and
 * gray/RGB changes rebuild each layer's style; band-number changes rebuild
 * each layer's source.
 */
export class DisplayController {
    /** Bands available in every file (the minimum over all files). */
    private nBands: number;
    readonly listeners = new Set<(state: DisplayState) => void>();
    private current: DisplayState;
    private readonly layers: { layer: DisplayLayer; makeSource: MakeSource }[] =
        [];

    /**
     * @param display User overrides, merged onto DISPLAY.
     * @param bandCount Bands available in every file (the minimum over all
     *   files), which bounds the band pickers. Changes with setBandCount as
     *   files are added and removed.
     */
    constructor(display: Partial<DisplayState> = {}, bandCount = 1) {
        this.nBands = bandCount;
        this.current = initialDisplay(display);
        const error = validateDisplay(this.current, bandCount);
        if (error) throw new Error(`Invalid display config: ${error}`);
    }

    /** Bands available in every file (the minimum over all files). */
    get bandCount(): number {
        return this.nBands;
    }

    /**
     * Set the bands available in every file (files were added or removed).
     * Band numbers the files no longer have are clamped into range (RGB
     * becomes gray below 3 bands), which rebuilds the sources. Listeners are
     * notified even when the state is unchanged, so band pickers can follow.
     */
    setBandCount(n: number): void {
        if (!Number.isInteger(n) || n < 1) {
            throw new Error(`band count must be a positive integer, got ${n}`);
        }
        this.nBands = n;
        const { bands } = this.current;
        if (validateDisplay(this.current, n) === null) {
            this.listeners.forEach((fn) => fn(this.current));
            return;
        }
        const next =
            bands.length === 3 && n >= 3
                ? bands.map((b) => Math.min(b, n))
                : [Math.min(bands[0], n)];
        console.warn(`bands ${bands} not in every file; showing ${next}`);
        // valid by construction; update() notifies
        this.update({ bands: next });
    }

    /** The current state. Change it with update(). */
    get state(): Readonly<DisplayState> {
        return this.current;
    }

    /** Style for a new layer, from the current state. */
    styleFor() {
        return buildStyle(this.current);
    }

    /** Track a layer so updates reach it. */
    addLayer(layer: DisplayLayer, makeSource: MakeSource): void {
        this.layers.push({ layer, makeSource });
    }

    /** Stop tracking a layer (its file was removed). */
    removeLayer(layer: DisplayLayer): void {
        const i = this.layers.findIndex((l) => l.layer === layer);
        if (i >= 0) this.layers.splice(i, 1);
    }

    /** Stop tracking every layer (their files are being re-placed in a new view). */
    clearLayers(): void {
        this.layers.length = 0;
    }

    /**
     * Subscribe to successful updates.
     * @returns Unsubscribe.
     */
    onChange(fn: (state: DisplayState) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /**
     * Apply a partial change to every layer.
     * @returns Error message (state unchanged), or null.
     */
    update(changes: Partial<DisplayState>): string | null {
        if ("nodata" in changes) return "nodata is fixed when the map is built";
        const next = nextState(this.current, changes);
        const error = validateDisplay(next, this.nBands);
        if (error) return error;

        const prev = this.current;
        this.current = next;
        const resource = !sameBands(next.bands, prev.bands);
        const restyle =
            next.scale !== prev.scale ||
            next.colormap !== prev.colormap ||
            next.bands.length !== prev.bands.length;
        for (const { layer, makeSource } of this.layers) {
            if (resource) layer.setSource(makeSource(next));
            if (restyle) layer.setStyle(buildStyle(next));
            else layer.updateStyleVariables(styleVariables(next));
        }
        this.listeners.forEach((fn) => fn(next));
        return null;
    }
}
