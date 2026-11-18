import { beforeEach, describe, expect, it, vi } from "vitest";
import BaseLayer from "ol/layer/Base.js";
import LayerGroup from "ol/layer/Group.js";
import type { Extent } from "ol/extent.js";
import { BODIES } from "../src/bodies.js";
import { DisplayController } from "../src/display.js";
import type { Meta, MetaResult } from "../src/metadata.js";
import { ViewController } from "../src/view.js";

// Header reads and WebGL layers can't run here: SourceManager's bookkeeping
// is what's tested.
vi.mock("../src/metadata.js", () => ({ readAllMeta: vi.fn() }));
vi.mock("../src/layers.js", () => ({ createLayer: vi.fn() }));

const { readAllMeta } = vi.mocked(await import("../src/metadata.js"));
const { createLayer } = vi.mocked(await import("../src/layers.js"));
const { SourceManager, fileName } = await import("../src/sources.js");

const JUP = { a: 71492000, b: 66854000, names: ["Jupiter"] };
const MARS = { a: 3396190, b: 3396190, names: ["MARS"] };

/** A file's header; files named "south*" lie outside polar-north views. */
function meta(url: string, over: Partial<Meta> = {}): Meta {
    return {
        url,
        def: "+proj=laea +lat_0=-20 +lon_0=0 +a=71492000 +b=66854000 +no_defs",
        bounds: [-1e6, -1e6, 1e6, 1e6],
        resolution: 1000,
        width: 2000,
        height: 2000,
        bandCount: 15,
        nodata: null,
        ellipsoid: JUP,
        ...over,
    };
}

/** Serve these headers; any other URL fails with "404". */
function serve(...metas: Meta[]) {
    readAllMeta.mockImplementation(async (urls: string[]) =>
        urls.map((url): MetaResult => {
            const m = metas.find((x) => x.url === url);
            return m ? { url, meta: m } : { url, error: "404" };
        }),
    );
}

type FakeLayer = BaseLayer & {
    url: string;
    setSource: () => void;
    setStyle: () => void;
    updateStyleVariables: () => void;
};

/** Every layer createLayer has made, in order. */
let made: FakeLayer[];

beforeEach(() => {
    made = [];
    readAllMeta.mockReset();
    createLayer.mockReset();
    createLayer.mockImplementation((m, view, controller) => {
        if (m.url.startsWith("south") && view.code.endsWith("NPSTERE")) {
            return null;
        }
        const extent: Extent = [0, 0, 10, 10].map((v) => v + made.length * 100);
        const layer = Object.assign(new BaseLayer({ extent }), {
            url: m.url,
            setSource: vi.fn(),
            setStyle: vi.fn(),
            updateStyleVariables: vi.fn(),
        });
        vi.spyOn(layer, "dispose");
        controller.addLayer(layer, vi.fn());
        made.push(layer);
        return layer as never;
    });
});

function setup(projection = "eqc") {
    const group = new LayerGroup();
    const view = new ViewController(projection);
    const display = new DisplayController({ bands: [4, 3, 2] }, 4);
    const sources = new SourceManager(group, view, display);
    const changes = vi.fn();
    sources.onChange(changes);
    const groupUrls = () =>
        group
            .getLayers()
            .getArray()
            .map((l) => (l as FakeLayer).url);
    return { group, view, display, sources, changes, groupUrls };
}

describe("SourceManager", () => {
    it("adds files, sets the body from the first one, and fills the group", async () => {
        const t = setup();
        serve(meta("a.tif"), meta("b.tif"));
        const result = await t.sources.add(["a.tif", "b.tif"]);
        expect(result).toEqual({ added: ["a.tif", "b.tif"], errors: [] });
        expect(t.view.state.body).toBe(BODIES.jupiter);
        expect(t.view.state.view.code).toBe("JUP:EQC");
        expect(t.groupUrls()).toEqual(["a.tif", "b.tif"]);
        expect(t.sources.entries.map((e) => [e.name, e.visible])).toEqual([
            ["a.tif", true],
            ["b.tif", true],
        ]);
        expect(t.changes).toHaveBeenCalled();
    });

    it("reports unreadable, duplicate and blank URLs per file", async () => {
        const t = setup();
        serve(meta("a.tif"));
        await t.sources.add(["a.tif"]);
        const result = await t.sources.add(["  ", "a.tif", "missing.tif"]);
        expect(result).toEqual({
            added: [],
            errors: [
                { url: "a.tif", error: "already added" },
                { url: "missing.tif", error: "404" },
            ],
        });
        expect(t.sources.entries).toHaveLength(1);
    });

    it("refuses files on another body while any file is loaded", async () => {
        const t = setup();
        serve(meta("jup.tif"), meta("mars.tif", { ellipsoid: MARS }));
        const result = await t.sources.add(["jup.tif", "mars.tif"]);
        expect(result.added).toEqual(["jup.tif"]);
        expect(result.errors[0].error).toMatch(
            "Mars data, but the map shows Jupiter",
        );

        // Once the map is empty, the next file decides the body again.
        t.sources.remove("jup.tif");
        expect((await t.sources.add(["mars.tif"])).added).toEqual(["mars.tif"]);
        expect(t.view.state.view.code).toBe("MARS:EQC");
    });

    it("limits the band pickers to bands every file has", async () => {
        const t = setup();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        serve(meta("a.tif"), meta("one.tif", { bandCount: 1 }));
        await t.sources.add(["a.tif"]);
        expect(t.display.bandCount).toBe(15);
        await t.sources.add(["one.tif"]);
        expect(t.display.bandCount).toBe(1);
        expect(t.display.state.bands).toEqual([1]);
        t.sources.remove("one.tif");
        expect(t.display.bandCount).toBe(15);
    });

    it("toggles visibility on the layer", async () => {
        const t = setup();
        serve(meta("a.tif"));
        await t.sources.add(["a.tif"]);
        t.sources.setVisible("a.tif", false);
        expect(made[0].getVisible()).toBe(false);
        expect(t.sources.entries[0].visible).toBe(false);
    });

    it("removes a file: layer out of the group and display, disposed", async () => {
        const t = setup();
        serve(meta("a.tif"), meta("b.tif"));
        await t.sources.add(["a.tif", "b.tif"]);
        const [a] = made;
        t.sources.remove("a.tif");
        expect(t.groupUrls()).toEqual(["b.tif"]);
        expect(a.dispose).toHaveBeenCalled();
        t.display.update({ min: 0.5 });
        expect(a.updateStyleVariables).not.toHaveBeenCalled();
        expect(made[1].updateStyleVariables).toHaveBeenCalled();
    });

    it("re-places every file on a projection change, keeping visibility", async () => {
        const t = setup();
        serve(meta("a.tif"), meta("south.tif"));
        await t.sources.add(["a.tif", "south.tif"]);
        t.sources.setVisible("a.tif", false);
        const old = [...made];

        t.view.update({ projection: "npstere" });
        old.forEach((l) => expect(l.dispose).toHaveBeenCalled());
        // south.tif is outside the north polar view: listed, no layer
        expect(t.sources.entries.map((e) => e.layer === null)).toEqual([
            false,
            true,
        ]);
        expect(t.groupUrls()).toEqual(["a.tif"]);
        expect(made.at(-1)!.getVisible()).toBe(false);

        // Display updates reach only the new layers.
        t.display.update({ min: 0.5 });
        old.forEach((l) =>
            expect(l.updateStyleVariables).not.toHaveBeenCalled(),
        );
    });

    it("gives the extent of placed layers", async () => {
        const t = setup();
        expect(t.sources.extent()).toBeNull();
        serve(meta("a.tif"), meta("b.tif"));
        await t.sources.add(["a.tif", "b.tif"]);
        expect(t.sources.extent(["b.tif"])).toEqual([100, 100, 110, 110]);
        expect(t.sources.extent()).toEqual([0, 0, 110, 110]);
    });

    it("runs adds one at a time, so the first file sets the body", async () => {
        const t = setup();
        serve(meta("jup.tif"), meta("mars.tif", { ellipsoid: MARS }));
        const [jup, mars] = await Promise.all([
            t.sources.add(["jup.tif"]),
            t.sources.add(["mars.tif"]),
        ]);
        expect(jup.added).toEqual(["jup.tif"]);
        expect(mars.added).toEqual([]);
        expect(t.view.state.body).toBe(BODIES.jupiter);
    });
});

describe("fileName", () => {
    it.each([
        ["https://host/data/a.tif?x=1#y", "a.tif"],
        ["public/b.tif", "b.tif"],
        ["c.tif", "c.tif"],
    ])("%s -> %s", (url, name) => expect(fileName(url)).toBe(name));
});
