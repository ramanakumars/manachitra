// One display state shared by every layer, so tiles stretch identically
// (no seams between files).
//   bands    : FILE band numbers to show (1-based); 1 band = gray (colormap
//              applies), 3 bands = RGB. Only these bands are read, so
//              changing them rebuilds each layer's source (refetches tiles).
//   min/max  : stretch limits (numbers, same for every band shown).
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

export interface DisplayState {
    /** 1 (gray) or 3 (RGB) FILE band numbers, 1-based. */
    bands: number[];
    min: number;
    max: number;
    scale: Scale;
    colormap: ColormapName;
    /** Override of the files' GDAL nodata value(s). */
    nodata?: number | number[];
}

export const DISPLAY: Readonly<DisplayState> = {
    bands: [1],
    min: 0,
    max: 500,
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
    readonly bandCount: number;
    readonly listeners = new Set<(state: DisplayState) => void>();
    private current: DisplayState;
    private readonly layers: { layer: DisplayLayer; makeSource: MakeSource }[] =
        [];

    /**
     * @param display User overrides, merged onto DISPLAY.
     * @param bandCount Bands available in every file (the minimum over all
     *   files), which bounds the band pickers.
     */
    constructor(display: Partial<DisplayState> = {}, bandCount = 1) {
        this.bandCount = bandCount;
        this.current = withOwnBands({ ...DISPLAY, ...display });
        const error = validateDisplay(this.current, bandCount);
        if (error) throw new Error(`Invalid display config: ${error}`);
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
        const next = withOwnBands({ ...this.current, ...changes });
        const error = validateDisplay(next, this.bandCount);
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
