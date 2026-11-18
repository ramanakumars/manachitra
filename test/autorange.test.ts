import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoRange } from "../src/autorange.js";
import type { AutoSources, Sampler } from "../src/autorange.js";
import { DisplayController } from "../src/display.js";
import type { DisplayState } from "../src/display.js";
import type { SourceEntry } from "../src/sources.js";

afterEach(() => vi.restoreAllMocks());

/** Entries for files keyed by URL (the value is the sampler's offset). */
function fakeSources(files: Record<string, number>) {
    let listener: () => void = () => {};
    const entries: SourceEntry[] = Object.keys(files).map((url) => ({
        url,
        name: url,
        meta: {
            nodata: url.includes("nodata") ? -1 : null,
        } as SourceEntry["meta"],
        visible: true,
        layer: {} as SourceEntry["layer"],
    }));
    const sources: AutoSources & { notify: () => void } = {
        entries,
        onChange: (fn) => {
            listener = fn as () => void;
            return () => {};
        },
        notify: () => listener(),
    };
    return sources;
}

/** A sampler where every band of `url` holds files[url] + 0..100. */
function fakeSampler(files: Record<string, number>) {
    return vi.fn<Sampler>(async (url, bands) =>
        bands.map(() =>
            Float64Array.from({ length: 101 }, (_, i) => files[url] + i),
        ),
    );
}

function setup(
    files: Record<string, number>,
    display: Partial<DisplayState> = {},
) {
    const sources = fakeSources(files);
    const controller = new DisplayController(display, 15);
    const sample = fakeSampler(files);
    const auto = new AutoRange(sources, controller, sample);
    return { sources, controller, sample, auto };
}

describe("AutoRange", () => {
    it("sets min/max to the pooled 2-98% range of the shown files", async () => {
        const t = setup({ "a.tif": 0, "b.tif": 100 }); // 0..100, 100..200
        await t.auto.refresh();
        // 202 pooled values; nearest rank 2% -> index 4, 98% -> index 197
        expect(t.controller.state).toMatchObject({
            auto: true,
            min: 4,
            max: 196,
        });
    });

    it("does nothing while auto is off", async () => {
        const t = setup({ "a.tif": 0 }, { min: 0, max: 1 });
        await t.auto.refresh();
        expect(t.sample).not.toHaveBeenCalled();
        expect(t.controller.state).toMatchObject({ min: 0, max: 1 });
    });

    it("recomputes when auto is turned back on", async () => {
        const t = setup({ "a.tif": 0 }, { min: 0, max: 1 });
        t.controller.update({ auto: true });
        await t.auto.refresh();
        expect(t.controller.state).toMatchObject({ min: 2, max: 98 });
    });

    it("leaves out hidden files and files outside the view", async () => {
        const t = setup({ "a.tif": 0, "b.tif": 100, "c.tif": 1000 });
        t.sources.entries[1].visible = false;
        t.sources.entries[2].layer = null;
        t.sources.notify();
        await t.auto.refresh();
        expect(t.controller.state).toMatchObject({ min: 2, max: 98 });
    });

    it("samples each file once per band set, and again for new bands", async () => {
        const t = setup({ "a.tif": 0 });
        await t.auto.refresh();
        t.sources.notify(); // e.g. visibility of another file
        await t.auto.refresh();
        expect(t.sample).toHaveBeenCalledTimes(1);
        t.controller.update({ bands: [4, 3, 2] });
        await t.auto.refresh();
        expect(t.sample).toHaveBeenCalledTimes(2);
        expect(t.sample).toHaveBeenLastCalledWith("a.tif", [4, 3, 2], []);
    });

    it("passes each file's nodata to the sampler", async () => {
        const t = setup({ "nodata.tif": 0 });
        await t.auto.refresh();
        expect(t.sample).toHaveBeenCalledWith("nodata.tif", [1], [-1]);
    });

    it("uses positive values only on a log scale", async () => {
        const t = setup({ "a.tif": 0 });
        t.controller.update({ scale: "log" });
        await t.auto.refresh();
        // 1..100 (0 dropped): 2% -> 3, 98% -> 98
        expect(t.controller.state).toMatchObject({ min: 3, max: 98 });
    });

    it("keeps the range when no file is shown", async () => {
        const t = setup({});
        await t.auto.refresh();
        expect(t.controller.state).toMatchObject({ min: 0, max: 500 });
    });

    it("drops a result the user overtook by setting min/max", async () => {
        const t = setup({ "a.tif": 0 });
        t.controller.update({ min: 10, max: 20 }); // auto off before samples land
        await t.auto.refresh();
        expect(t.controller.state).toMatchObject({
            auto: false,
            min: 10,
            max: 20,
        });
    });

    it("survives a file that can't be sampled", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const t = setup({ "a.tif": 0, "bad.tif": 0 });
        t.sample.mockImplementation(async (url, bands) => {
            if (url === "bad.tif") throw new Error("404");
            return bands.map(() =>
                Float64Array.from({ length: 101 }, (_, i) => i),
            );
        });
        (t.sources.entries as SourceEntry[]).push({
            ...t.sources.entries[0],
            url: "late.tif",
        });
        t.sources.notify();
        await t.auto.refresh();
        expect(t.controller.state).toMatchObject({ min: 2, max: 98 });
    });
});
