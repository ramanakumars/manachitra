// manachitra: planetary COG/GeoTIFF viewer on OpenLayers + proj4js.
//
//   const map = await buildMap("map", {
//       body: "jupiter", // name from BODIES, or { name, code, a, b }
//       projection: "eqc", // "eqc" | "moll" | "npstere" | "spstere"
//       sources: ["a.tif", ...], // COG URLs (CORS + HTTP Range)
//       // optional, merged onto DISPLAY (see display.ts):
//       display: { bands, min, max, scale, colormap, nodata },
//   });
//   map.get("display").update({ min: 0, max: 1 }); // same as the toolbar
import "./manachitra.css";
import Map from "ol/Map.js";
import View from "ol/View.js";
import LayerGroup from "ol/layer/Group.js";
import type WebGLTileLayer from "ol/layer/WebGLTile.js";
import { getBody } from "./bodies.js";
import type { BodyRef } from "./bodies.js";
import { viewCrs } from "./projections.js";
import type { ProjectionRef } from "./projections.js";
import { defineView, codeForSource, registerAll } from "./crs.js";
import { readAllMeta } from "./metadata.js";
import { DISPLAY, DisplayController, validateDisplay } from "./display.js";
import type { DisplayState } from "./display.js";
import { createLayer } from "./layers.js";
import { Toolbar } from "./controls/Toolbar.js";
import { LonLat } from "./controls/LonLat.js";
import { createGraticule } from "./graticule.js";

export interface MapOptions {
    /** Name from BODIES (case-insensitive), or a custom body. */
    body: BodyRef;
    /** Key of PROJECTIONS (case-insensitive). */
    projection: ProjectionRef;
    /** COG URLs. */
    sources: string[];
    /** Initial display state, merged onto DISPLAY. */
    display?: Partial<DisplayState>;
}

/**
 * Build a map of one body in one view projection from a list of COGs.
 * @param target Map container (element or id).
 * @returns The map; its "display" property is the DisplayController. Layer 0
 *   is the sources group, layer 1 the lon/lat grid (hidden until toggled).
 */
export async function buildMap(
    target: string | HTMLElement,
    options: MapOptions,
): Promise<Map> {
    const { body, projection, sources, display = {} } = options;
    // Checked at runtime too: JS callers get no compile-time check.
    if (!Array.isArray(sources)) {
        throw new Error("`sources` must be an array of URLs");
    }

    // Validate arguments before any network traffic (band numbers can only
    // be checked once the headers are read).
    const b = getBody(body);
    const view = viewCrs(b, projection);
    const error = validateDisplay({ ...DISPLAY, ...display }, Infinity);
    if (error) throw new Error(`Invalid display config: ${error}`);

    // All proj4.defs first (view + one per distinct source CRS), then register once.
    defineView(view);
    const metas = (await readAllMeta(sources)).map((m) => ({
        ...m,
        code: codeForSource(b, m.def),
    }));
    registerAll(view);

    if (!metas.length) {
        throw new Error(
            `None of the ${sources.length} sources could be read (see console)`,
        );
    }
    // Band pickers are limited to bands present in every file.
    const bandCount = Math.min(...metas.map((m) => m.bandCount));
    const controller = new DisplayController(display, bandCount);
    const layers = metas
        .map((m) => createLayer(m, view, controller))
        // null = outside the view projection's extent
        .filter((layer): layer is WebGLTileLayer => layer !== null);

    // The layer group stays the first layer (index.html relies on it); the
    // grid draws on top of it.
    const graticule = createGraticule();
    const map = new Map({
        target,
        layers: [
            new LayerGroup({ layers, properties: { name: "sources" } }),
            graticule,
        ],
        view: new View({ projection: view.code, center: [0, 0], zoom: 0 }),
    });
    map.addControl(new Toolbar(controller, { graticule }));
    map.addControl(new LonLat(view, b));
    map.set("display", controller);
    map.getView().fit(view.extent, { size: map.getSize() });
    return map;
}

export { BODIES, getBody } from "./bodies.js";
export type { Body, BodyName, BodyRef, CustomBody } from "./bodies.js";
export { PROJECTIONS, viewCrs } from "./projections.js";
export type { ProjectionName, ProjectionRef, ViewCrs } from "./projections.js";
export { DISPLAY, SCALES, DisplayController } from "./display.js";
export type { DisplayState, Scale } from "./display.js";
export { COLORMAPS } from "./colormaps.js";
export type { ColormapName } from "./colormaps.js";
export { Toolbar } from "./controls/Toolbar.js";
export { LonLat } from "./controls/LonLat.js";
