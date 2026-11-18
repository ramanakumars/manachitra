// manachitra: planetary COG/GeoTIFF viewer on OpenLayers + proj4js.
//
//   const map = await buildMap("map"); // empty map, eqc; add COGs with "+"
//   const map = await buildMap("map", { // every option is optional
//       projection: "eqc", // "eqc" | "moll" | "npstere" | "spstere"
//       sources: ["a.tif", ...], // COG URLs (CORS + HTTP Range); optional
//       // optional, merged onto DISPLAY (see display.ts):
//       display: { bands, min, max, scale, colormap, nodata },
//   });
//   // The body is read from the files' CRS (detectBody).
//   map.get("display").update({ min: 0, max: 1 }); // same as the toolbar;
//   // giving min/max turns the auto range off; { auto: true } turns it on
//   map.get("viewController").update({ projection: "moll" }); // the view bar
//   await map.get("sources").add(["b.tif"]); // the layers panel's "+"
// OL's control styles first, so ours override them.
import "ol/ol.css";
import "./manachitra.css";
import Map from "ol/Map.js";
import View from "ol/View.js";
import Control from "ol/control/Control.js";
import LayerGroup from "ol/layer/Group.js";
import { DisplayController, initialDisplay } from "./display.js";
import { resolveOptions } from "./options.js";
import type { MapOptions } from "./options.js";
import { SourceManager } from "./sources.js";
import { AutoRange } from "./autorange.js";
import { NO_BODY, ViewController } from "./view.js";
import { Toolbar } from "./controls/Toolbar.js";
import { ViewBar } from "./controls/ViewBar.js";
import { LayerPanel } from "./controls/LayerPanel.js";
import { LonLat } from "./controls/LonLat.js";
import { el } from "./controls/dom.js";
import { createGraticule } from "./graticule.js";

/**
 * Build a map of COGs in a view projection. The body comes from the files'
 * CRS; with no sources the map starts empty (layers panel open for URLs), and
 * the first file added sets it.
 * @param target Map container (element or id).
 * @param options All optional (see MapOptions); omitted or null gives the
 *   defaults: DEFAULT_PROJECTION, no sources, DISPLAY.
 * @returns The map. Properties: "display" (DisplayController),
 *   "viewController" (ViewController: body + projection; the view bar edits
 *   the projection), "sources" (SourceManager: the files; the layers panel
 *   edits it) and "autoRange" (AutoRange: keeps min/max at the data's range
 *   while display.auto is on). Layer 0 is the sources group, layer 1 the
 *   lon/lat grid (hidden until toggled).
 * @throws If arguments are invalid, or sources were given and none of them
 *   could be added.
 */
export async function buildMap(
    target: string | HTMLElement,
    options?: MapOptions | null,
): Promise<Map> {
    // Validate arguments before any network traffic.
    const { projection, sources, display } = resolveOptions(options);
    const viewController = new ViewController(projection);
    // Provisional band count until files are read (SourceManager sets it).
    const controller = new DisplayController(
        display,
        Math.max(...initialDisplay(display).bands),
    );

    // Layer 0 is the sources group, with the grid drawn on top of it.
    // SourceManager subscribes to view changes first, so layers are re-placed
    // before the listeners below run.
    const group = new LayerGroup({ properties: { name: "sources" } });
    const manager = new SourceManager(group, viewController, controller);
    // Keeps min/max at the data's range while display.auto is on.
    const autoRange = new AutoRange(manager, controller);
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
    const panel = new LayerPanel(manager, { target: column, onAdded: zoomTo });
    map.addControl(panel);
    map.addControl(lonLat);
    map.set("display", controller);
    map.set("viewController", viewController);
    map.set("sources", manager);
    map.set("autoRange", autoRange);
    map.setView(
        new View({
            projection: viewController.state.view.code,
            center: [0, 0],
            zoom: 0,
        }),
    );
    zoomTo();
    // Starting from scratch: ready for the first URLs.
    if (!manager.entries.length) panel.openForm();
    return map;
}

export { DEFAULT_PROJECTION } from "./options.js";
export type { MapOptions } from "./options.js";
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
export { AutoRange } from "./autorange.js";
export { AUTO_PERCENTILES } from "./stats.js";
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
