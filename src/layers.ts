import WebGLTileLayer from "ol/layer/WebGLTile.js";
import GeoTIFF from "ol/source/GeoTIFF.js";
import { footprintInView } from "./crs.js";
import { sourceInfo } from "./display.js";
import type { DisplayController, DisplayState } from "./display.js";
import type { SourceMeta } from "./metadata.js";
import type { ViewCrs } from "./projections.js";

/** GeoTIFF source for one file, reading only the bands in `display`. */
export function createSource(meta: SourceMeta, display: DisplayState): GeoTIFF {
    return new GeoTIFF({
        sources: [sourceInfo(meta.url, display)],
        projection: meta.code, // skip OL's EPSG-only detection
        normalize: false, // raw values; the style does the stretch
        interpolate: true,
    });
}

/**
 * One WebGL tile layer for one file, registered with the display controller.
 * Returns null if the file lies entirely outside the view projection's
 * extent.
 */
export function createLayer(
    meta: SourceMeta,
    view: ViewCrs,
    controller: DisplayController,
): WebGLTileLayer | null {
    const extent = footprintInView(meta.bounds, meta.code, view);
    if (extent === null) {
        console.info(meta.url, `outside ${view.code} extent; skipped`);
        return null;
    }

    const layer = new WebGLTileLayer({
        // Footprint in view coords: OL skips fetching when it's off-screen.
        extent,
        // Only render when zoomed in reasonably close to native resolution
        // (source and view CRSs are both metres, so this is a fair approximation)
        maxResolution: meta.resolution * 64,
        properties: { name: meta.url.split("/").pop(), url: meta.url },
        source: createSource(meta, controller.state),
        style: controller.styleFor(),
    });
    controller.addLayer(layer, (state) => createSource(meta, state));
    return layer;
}
