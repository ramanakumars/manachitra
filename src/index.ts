// manachitra: planetary COG/GeoTIFF viewer on OpenLayers + proj4js.
//
//   const map = await buildMap("map", {
//       projection: "eqc", // "eqc" | "moll" | "npstere" | "spstere"
//       sources: ["a.tif", ...], // COG URLs (CORS + HTTP Range); optional
//       // optional, merged onto DISPLAY (see display.ts):
//       display: { bands, min, max, scale, colormap, nodata },
//   });
//   // The body is read from the files' CRS (detectBody).
//   map.get("display").update({ min: 0, max: 1 }); // same as the toolbar
//   map.get("viewController").update({ projection: "moll" }); // the view bar
//   await map.get("sources").add(["b.tif"]); // the layers panel's "+"
import "./manachitra.css";
import Map from "ol/Map.js";
import View from "ol/View.js";
import Control from "ol/control/Control.js";
import LayerGroup from "ol/layer/Group.js";
import type { ProjectionRef } from "./projections.js";
import {
    DISPLAY,
    DisplayController,
    MAX_BANDS,
    validateDisplay,
} from "./display.js";
import type { DisplayState } from "./display.js";
import { SourceManager } from "./sources.js";
import { NO_BODY, ViewController } from "./view.js";
import { Toolbar } from "./controls/Toolbar.js";
import { ViewBar } from "./controls/ViewBar.js";
import { LayerPanel } from "./controls/LayerPanel.js";
import { LonLat } from "./controls/LonLat.js";
import { el } from "./controls/dom.js";
import { createGraticule } from "./graticule.js";

export interface MapOptions {
    /** Key of PROJECTIONS (case-insensitive). */
    projection: ProjectionRef;
    /** COG URLs to load at start (more can be added from the layers panel). */
    sources?: string[];
    /** Initial display state, merged onto DISPLAY. */
    display?: Partial<DisplayState>;
}

/**
 * Build a map of COGs in a view projection. The body comes from the files'
 * CRS; with no sources the map starts empty, and the first file added sets it.
 * @param target Map container (element or id).
 * @returns The map. Properties: "display" (DisplayController),
 *   "viewController" (ViewController: body + projection; the view bar edits
 *   the projection) and "sources" (SourceManager: the files; the layers panel
 *   edits it). Layer 0 is the sources group, layer 1 the lon/lat grid (hidden
 *   until toggled).
 * @throws If arguments are invalid, or sources were given and none of them
 *   could be added.
 */
export async function buildMap(
    target: string | HTMLElement,
    options: MapOptions,
): Promise<Map> {
    const { projection, sources = [], display = {} } = options;
    // Checked at runtime too: JS callers get no compile-time check.
    if (!Array.isArray(sources)) {
        throw new Error("`sources` must be an array of URLs");
    }
    if ("body" in options) {
        console.warn("`body` is ignored: it is read from the files' CRS");
    }

    // Validate arguments before any network traffic (band numbers can only
    // be checked against the files once the headers are read; until then the
    // TIFF limit bounds them, which also bounds the empty map's band pickers).
    const viewController = new ViewController(projection);
    const initial = { ...DISPLAY, ...display };
    const error = validateDisplay(initial, MAX_BANDS);
    if (error) throw new Error(`Invalid display config: ${error}`);
    // Provisional band count until files are read (SourceManager sets it).
    const controller = new DisplayController(
        display,
        Math.max(...initial.bands),
    );

    // Layer 0 is the sources group, with the grid drawn on top of it.
    // SourceManager subscribes to view changes first, so layers are re-placed
    // before the listeners below run.
    const group = new LayerGroup({ properties: { name: "sources" } });
    const manager = new SourceManager(group, viewController, controller);
    const { added, errors } = await manager.add(sources);
    if (sources.length && !added.length) {
        const why = errors.map((e) => `${e.url}: ${e.error}`).join("; ");
        throw new Error(
            `None of the ${sources.length} sources could be added (${why})`,
        );
    }

    const graticule = createGraticule();
    const map = new Map({ target, layers: [group, graticule] });
    const lonLat = new LonLat(
        viewController.state.view,
        viewController.state.body ?? NO_BODY,
    );

    /** Zoom to these files (default: all), or the whole view if none show. */
    const zoomTo = (urls?: string[]) => {
        const extent = manager.extent(urls) ?? viewController.state.view.extent;
        // Top: view bar. Right: toolbar and layers panel.
        map.getView().fit(extent, {
            size: map.getSize(),
            padding: [48, 24, 24, 24],
        });
    };
    viewController.onChange((state) => {
        map.setView(
            new View({ projection: state.view.code, center: [0, 0], zoom: 0 }),
        );
        zoomTo();
        lonLat.setView(state.view, state.body ?? NO_BODY);
    });

    // Toolbar and layers panel stack in one right-hand column. The column
    // itself lets pointer events through to the map.
    const column = el("div", { className: "mc-column" });
    column.style.pointerEvents = "none";
    map.addControl(new ViewBar(viewController));
    map.addControl(new Control({ element: column }));
    map.addControl(new Toolbar(controller, { graticule, target: column }));
    map.addControl(
        new LayerPanel(manager, { target: column, onAdded: zoomTo }),
    );
    map.addControl(lonLat);
    map.set("display", controller);
    map.set("viewController", viewController);
    map.set("sources", manager);
    map.setView(
        new View({
            projection: viewController.state.view.code,
            center: [0, 0],
            zoom: 0,
        }),
    );
    zoomTo();
    return map;
}

export { BODIES, detectBody, getBody } from "./bodies.js";
export type {
    Body,
    BodyName,
    BodyRef,
    CustomBody,
    Ellipsoid,
} from "./bodies.js";
export { PROJECTIONS, viewCrs } from "./projections.js";
export type { ProjectionName, ProjectionRef, ViewCrs } from "./projections.js";
export { DISPLAY, SCALES, DisplayController } from "./display.js";
export type { DisplayState, Scale } from "./display.js";
export { COLORMAPS } from "./colormaps.js";
export type { ColormapName } from "./colormaps.js";
export { NO_BODY, ViewController } from "./view.js";
export { SourceManager } from "./sources.js";
export type { AddResult, SourceEntry } from "./sources.js";
export type { ViewChange, ViewState } from "./view.js";
export { Toolbar } from "./controls/Toolbar.js";
export { ViewBar } from "./controls/ViewBar.js";
export { LayerPanel } from "./controls/LayerPanel.js";
export { LonLat } from "./controls/LonLat.js";
