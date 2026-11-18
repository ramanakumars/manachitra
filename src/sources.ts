// The files on the map: one entry per COG URL, in drawing order (last on
// top). Owns the "sources" layer group's contents, and keeps three things in
// step with the list:
//   - the body: read from the first file added to an empty map (detectBody);
//     files on another body are refused while any file is loaded;
//   - the band count (minimum over files), which bounds the band pickers;
//   - each file's layer, rebuilt for every view change. A file outside the
//     view projection's extent stays listed with `layer: null`.
import type LayerGroup from "ol/layer/Group.js";
import type WebGLTileLayer from "ol/layer/WebGLTile.js";
import { createEmpty, extend, isEmpty } from "ol/extent.js";
import type { Extent } from "ol/extent.js";
import { detectBody, sameBody } from "./bodies.js";
import type { Body } from "./bodies.js";
import { codeForSource, defineView, registerAll } from "./crs.js";
import type { DisplayController } from "./display.js";
import { createLayer } from "./layers.js";
import { readAllMeta } from "./metadata.js";
import type { Meta } from "./metadata.js";
import { NO_BODY } from "./view.js";
import type { ViewController, ViewState } from "./view.js";

export interface SourceEntry {
    /** COG URL, also the entry's id (a URL can only be added once). */
    readonly url: string;
    /** File name, for display. */
    readonly name: string;
    readonly meta: Meta;
    /** The user's choice; kept while the file is outside the view. */
    visible: boolean;
    /** Null while the file lies outside the view projection's extent. */
    layer: WebGLTileLayer | null;
}

export interface AddResult {
    /** URLs now on the map, in input order. */
    added: string[];
    /** URLs that weren't added, and why. */
    errors: { url: string; error: string }[];
}

/** Last path segment of a URL, without query or fragment. */
export const fileName = (url: string): string =>
    url
        .replace(/[?#].*$/, "")
        .split("/")
        .filter(Boolean)
        .pop() ?? url;

export class SourceManager {
    readonly listeners = new Set<(entries: readonly SourceEntry[]) => void>();
    private readonly list: SourceEntry[] = [];
    private readonly group: LayerGroup;
    private readonly view: ViewController;
    private readonly display: DisplayController;
    /** Adds run one after another, so body detection can't race. */
    private queue: Promise<unknown> = Promise.resolve();

    /**
     * Registers the current view projection with OL, and re-places every
     * file whenever the view changes. Create it before anything else
     * subscribes to `view`, so those listeners see the new layers.
     */
    constructor(
        group: LayerGroup,
        view: ViewController,
        display: DisplayController,
    ) {
        this.group = group;
        this.view = view;
        this.display = display;
        this.place([], view.state);
        view.onChange((state) => this.placeAll(state));
    }

    /** Files in drawing order (last on top). */
    get entries(): readonly SourceEntry[] {
        return this.list;
    }

    /**
     * Subscribe to list changes (added, removed, visibility, re-placed).
     * @returns Unsubscribe.
     */
    onChange(fn: (entries: readonly SourceEntry[]) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /**
     * Read and add COGs (blank and duplicate URLs are skipped/refused). The
     * first file added to an empty map sets the body; files on another body
     * are refused. File problems (unreadable, duplicate, other body) are
     * reported per URL rather than thrown; only unexpected errors reject.
     */
    add(urls: string[]): Promise<AddResult> {
        const run = this.queue.then(() => this.addNow(urls));
        this.queue = run.catch(() => {});
        return run;
    }

    /** Remove a file and dispose of its layer. */
    remove(url: string): void {
        const i = this.list.findIndex((e) => e.url === url);
        if (i < 0) return;
        const [entry] = this.list.splice(i, 1);
        if (entry.layer) {
            this.display.removeLayer(entry.layer);
            this.syncGroup();
            entry.layer.dispose(); // frees its WebGL context
        }
        this.syncBandCount();
        this.notify();
    }

    /** Show or hide a file (remembered across view changes). */
    setVisible(url: string, visible: boolean): void {
        const entry = this.list.find((e) => e.url === url);
        if (!entry || entry.visible === visible) return;
        entry.visible = visible;
        entry.layer?.setVisible(visible);
        this.notify();
    }

    /**
     * Union of the placed layers' extents (view coordinates), for zooming to
     * data. Null if none of them is in view.
     * @param urls Only these files (default: all).
     */
    extent(urls?: string[]): Extent | null {
        const ext = createEmpty();
        for (const e of this.list) {
            if (urls && !urls.includes(e.url)) continue;
            const layerExtent = e.layer?.getExtent();
            if (layerExtent) extend(ext, layerExtent);
        }
        return isEmpty(ext) ? null : ext;
    }

    private async addNow(urls: string[]): Promise<AddResult> {
        const errors: AddResult["errors"] = [];
        const seen = new Set(this.list.map((e) => e.url));
        const fresh: string[] = [];
        for (const raw of urls) {
            const url = raw.trim();
            if (!url) continue;
            if (seen.has(url)) {
                errors.push({ url, error: "already added" });
                continue;
            }
            seen.add(url);
            fresh.push(url);
        }

        // The current body binds only while files are loaded.
        let body: Body | null = this.list.length ? this.view.state.body : null;
        const accepted: Meta[] = [];
        for (const r of await readAllMeta(fresh)) {
            if (r.meta === undefined) {
                errors.push({ url: r.url, error: r.error });
                continue;
            }
            const fileBody = detectBody(r.meta.ellipsoid);
            body ??= fileBody;
            if (!sameBody(fileBody, body)) {
                errors.push({
                    url: r.url,
                    error: `${fileBody.name} data, but the map shows ${body.name} (remove all layers to switch)`,
                });
                continue;
            }
            accepted.push(r.meta);
        }
        if (!accepted.length) return { added: [], errors };

        const entries: SourceEntry[] = accepted.map((meta) => ({
            url: meta.url,
            name: fileName(meta.url),
            meta,
            visible: true,
            layer: null,
        }));
        this.list.push(...entries);
        // Before any layer is made: sources read the displayed band numbers.
        this.syncBandCount();
        if (sameBody(body, this.view.state.body)) {
            this.place(entries, this.view.state);
            this.notify();
        } else {
            // New body: the view listener re-places every file (and notifies).
            this.view.update({ body });
        }
        return { added: entries.map((e) => e.url), errors };
    }

    /** Re-place every file in a new view. */
    private placeAll(state: ViewState): void {
        const old = this.list.map((e) => e.layer);
        this.display.clearLayers();
        for (const e of this.list) e.layer = null;
        this.place(this.list, state);
        old.forEach((layer) => layer?.dispose()); // frees WebGL contexts
        this.notify();
    }

    /**
     * Make layers for `entries` in the view. All proj4 defs come first, then
     * registerAll (see crs.ts); the view is registered even with no files,
     * since the map's View needs it.
     */
    private place(entries: SourceEntry[], { body, view }: ViewState): void {
        defineView(view);
        const codes = entries.map((e) =>
            codeForSource(body ?? NO_BODY, e.meta.def),
        );
        registerAll(view);
        entries.forEach((e, i) => {
            e.layer = createLayer(
                { ...e.meta, code: codes[i] },
                view,
                this.display,
            );
            e.layer?.setVisible(e.visible);
        });
        this.syncGroup();
    }

    /** Put the placed layers into the group, in list order. */
    private syncGroup(): void {
        const layers = this.group.getLayers();
        layers.clear();
        for (const e of this.list) if (e.layer) layers.push(e.layer);
    }

    /** Band pickers offer only bands every file has. */
    private syncBandCount(): void {
        if (!this.list.length) return;
        this.display.setBandCount(
            Math.min(...this.list.map((e) => e.meta.bandCount)),
        );
    }

    private notify(): void {
        this.listeners.forEach((fn) => fn(this.list));
    }
}
