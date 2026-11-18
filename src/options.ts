// buildMap's options: all optional, so `buildMap("map")` gives an empty map
// ready for the user to add COGs.
import { initialDisplay, MAX_BANDS, validateDisplay } from "./display.js";
import type { DisplayState } from "./display.js";
import type { ProjectionName, ProjectionRef } from "./projections.js";

/** View projection when none is given. */
export const DEFAULT_PROJECTION: ProjectionName = "eqc";

export interface MapOptions {
    /** Key of PROJECTIONS (case-insensitive); default DEFAULT_PROJECTION. */
    projection?: ProjectionRef;
    /** COG URLs to load at start (more can be added from the layers panel). */
    sources?: string[];
    /** Initial display state, merged onto DISPLAY. */
    display?: Partial<DisplayState>;
}

/** MapOptions with defaults filled in. */
export interface ResolvedOptions {
    projection: ProjectionRef;
    sources: string[];
    display: Partial<DisplayState>;
}

/**
 * Fill in defaults and check what can be checked before any file is read.
 * Omitted or null options (or fields) take their defaults. The projection
 * name itself is checked by ViewController; band numbers are checked against
 * the files later, and only against the TIFF limit here (which also bounds
 * the empty map's band pickers).
 * @throws On options of the wrong type, or an invalid display state.
 */
export function resolveOptions(
    options: MapOptions | null | undefined,
): ResolvedOptions {
    // Checked at runtime too: JS callers get no compile-time check.
    const o: MapOptions = options ?? {};
    if (typeof o !== "object" || Array.isArray(o)) {
        throw new Error("options must be an object (or omitted)");
    }
    if ("body" in o) {
        console.warn("`body` is ignored: it is read from the files' CRS");
    }
    const sources = o.sources ?? [];
    if (
        !Array.isArray(sources) ||
        !sources.every((s) => typeof s === "string")
    ) {
        throw new Error("`sources` must be an array of URLs");
    }
    const display = o.display ?? {};
    if (typeof display !== "object" || Array.isArray(display)) {
        throw new Error("`display` must be an object");
    }
    const error = validateDisplay(initialDisplay(display), MAX_BANDS);
    if (error) throw new Error(`Invalid display config: ${error}`);
    return {
        projection: o.projection ?? DEFAULT_PROJECTION,
        sources,
        display,
    };
}
