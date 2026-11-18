// Auto stretch: while the display state's `auto` is on, keeps min/max at the
// AUTO_PERCENTILES of the shown data. "Shown" = visible files that are in the
// view, read for the displayed bands (all three pooled in RGB, since one
// stretch covers every channel); log scale uses positive values only.
// Recomputes when any of those inputs change; samples are cached per file
// and band set, so toggling visibility or switching projection rereads
// nothing.
import type { DisplayController, DisplayState } from "./display.js";
import type { SourceEntry, SourceManager } from "./sources.js";
import { AUTO_PERCENTILES, percentileRange, sampleFile } from "./stats.js";

/** Reads valid values of `bands` from a file, one array per band. */
export type Sampler = (
    url: string,
    bands: readonly number[],
    nodata: readonly number[],
) => Promise<Float64Array[]>;

/** The SourceManager members AutoRange uses. */
export type AutoSources = Pick<SourceManager, "entries" | "onChange">;

/** Values to ignore in a file: the display override, else its GDAL nodata. */
function nodataFor(entry: SourceEntry, state: DisplayState): number[] {
    if (state.nodata !== undefined) return [state.nodata].flat();
    return entry.meta.nodata === null ? [] : [entry.meta.nodata];
}

export class AutoRange {
    private readonly sources: AutoSources;
    private readonly display: DisplayController;
    private readonly sample: Sampler;
    private readonly cache = new Map<string, Promise<Float64Array[]>>();
    /** Inputs of the last computation started (skip if unchanged). */
    private lastKey = "";
    /** Bumped per computation; stale results are dropped. */
    private generation = 0;
    private pending: Promise<void> = Promise.resolve();

    constructor(
        sources: AutoSources,
        display: DisplayController,
        sample: Sampler = sampleFile,
    ) {
        this.sources = sources;
        this.display = display;
        this.sample = sample;
        sources.onChange(() => void this.refresh());
        display.onChange(() => void this.refresh());
        void this.refresh();
    }

    /**
     * Recompute if auto is on and the inputs changed.
     * @returns Resolves once the range is applied (or found unchanged).
     */
    refresh(): Promise<void> {
        const state = this.display.state;
        if (!state.auto) {
            this.lastKey = ""; // turning auto back on recomputes
            return this.pending;
        }
        const files = this.sources.entries.filter(
            (e) => e.visible && e.layer !== null,
        );
        const log = state.scale === "log";
        const key = JSON.stringify([
            files.map((e) => [e.url, nodataFor(e, state)]),
            state.bands,
            log,
        ]);
        if (key === this.lastKey) return this.pending;
        this.lastKey = key;
        this.dropRemovedFiles();
        const generation = ++this.generation;
        const bands = [...state.bands];
        this.pending = (async () => {
            const samples = await Promise.all(
                files.map((e) => this.samplesOf(e, bands, nodataFor(e, state))),
            );
            // A newer computation started, or the user took over.
            if (generation !== this.generation || !this.display.state.auto) {
                return;
            }
            const range = percentileRange(
                samples.flat(),
                AUTO_PERCENTILES,
                log,
            );
            if (!range) return; // nothing shown (yet): keep the current range
            const [min, max] = range;
            const s = this.display.state;
            if (s.min === min && s.max === max) return;
            const error = this.display.update({ min, max, auto: true });
            if (error) console.warn("auto range not applied:", error);
        })();
        return this.pending;
    }

    private samplesOf(
        entry: SourceEntry,
        bands: number[],
        nodata: number[],
    ): Promise<Float64Array[]> {
        const key = JSON.stringify([entry.url, bands, nodata]);
        let samples = this.cache.get(key);
        if (!samples) {
            samples = this.sample(entry.url, bands, nodata).catch((e) => {
                console.warn(entry.url, "could not be sampled:", e);
                this.cache.delete(key);
                return [];
            });
            this.cache.set(key, samples);
        }
        return samples;
    }

    /** Forget samples of files that are no longer on the map. */
    private dropRemovedFiles(): void {
        const urls = new Set(this.sources.entries.map((e) => e.url));
        for (const key of this.cache.keys()) {
            if (!urls.has(JSON.parse(key)[0])) this.cache.delete(key);
        }
    }
}
