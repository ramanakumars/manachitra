// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { LayerPanel, parseUrls } from "../src/controls/LayerPanel.js";
import type { LayerSource } from "../src/controls/LayerPanel.js";
import type { AddResult, SourceEntry } from "../src/sources.js";

/** A LayerSource holding plain entries; `layer: null` = outside the view. */
function fakeSources(names: string[] = [], outside: string[] = []) {
    let listener: (e: readonly SourceEntry[]) => void = () => {};
    const entries: SourceEntry[] = names.map((name) => ({
        url: `data/${name}`,
        name,
        meta: {} as SourceEntry["meta"],
        visible: true,
        layer: outside.includes(name) ? null : ({} as SourceEntry["layer"]),
    }));
    const sources = {
        entries,
        onChange: vi.fn((fn) => {
            listener = fn;
            return () => {};
        }),
        setVisible: vi.fn((url: string, v: boolean) => {
            entries.find((e) => e.url === url)!.visible = v;
            listener(entries);
        }),
        remove: vi.fn((url: string) => {
            entries.splice(
                entries.findIndex((e) => e.url === url),
                1,
            );
            listener(entries);
        }),
        add: vi.fn(
            async (urls: string[]): Promise<AddResult> => ({
                added: urls.filter((u) => !u.includes("bad")),
                errors: urls
                    .filter((u) => u.includes("bad"))
                    .map((url) => ({ url, error: "404" })),
            }),
        ),
    } satisfies LayerSource;
    return sources;
}

function setup(names?: string[], outside?: string[]) {
    const sources = fakeSources(names, outside);
    const onAdded = vi.fn();
    const panel = new LayerPanel(sources, { onAdded });
    const $ = <T extends Element>(sel: string) =>
        panel.root.querySelector<T>(sel)!;
    const items = () =>
        [...panel.root.querySelectorAll(".mc-layer-name")].map(
            (n) => n.textContent,
        );
    return { sources, panel, onAdded, $, items };
}

describe("LayerPanel", () => {
    it("lists layers topmost first, with a count", () => {
        const t = setup(["a.tif", "b.tif"]);
        expect(t.items()).toEqual(["b.tif", "a.tif"]);
        expect(t.$(".mc-panel-title").textContent).toBe("▾ Layers (2)");
    });

    it("says how to add layers when empty", () => {
        const t = setup();
        expect(t.$(".mc-empty").textContent).toMatch("Add COG URLs with +");
    });

    it("marks files outside the view", () => {
        const t = setup(["a.tif", "south.tif"], ["south.tif"]);
        const outside = t.panel.root.querySelectorAll(".mc-outside");
        expect(outside).toHaveLength(1);
        expect(outside[0].textContent).toMatch("south.tif");
        expect(outside[0].textContent).toMatch("not in view");
    });

    it("toggles visibility from the checkbox", () => {
        const t = setup(["a.tif"]);
        const box = t.$<HTMLInputElement>(".mc-layer input");
        box.checked = false;
        box.dispatchEvent(new Event("change"));
        expect(t.sources.setVisible).toHaveBeenCalledWith("data/a.tif", false);
        expect(t.$<HTMLInputElement>(".mc-layer input").checked).toBe(false);
    });

    it("removes a layer", () => {
        const t = setup(["a.tif", "b.tif"]);
        t.$<HTMLButtonElement>('[aria-label="Remove a.tif"]').click();
        expect(t.sources.remove).toHaveBeenCalledWith("data/a.tif");
        expect(t.items()).toEqual(["b.tif"]);
        expect(t.$(".mc-panel-title").textContent).toBe("▾ Layers (1)");
    });

    it("collapses to its header, keeping + available", () => {
        const t = setup(["a.tif"]);
        const title = t.$<HTMLButtonElement>(".mc-panel-title");
        title.click();
        expect(t.panel.collapsed).toBe(true);
        expect(title.getAttribute("aria-expanded")).toBe("false");
        expect(title.textContent).toBe("▸ Layers (1)");
        // + reopens the panel with the form showing
        t.$<HTMLButtonElement>(".mc-add").click();
        expect(t.panel.collapsed).toBe(false);
        expect(t.$<HTMLFormElement>(".mc-add-form").hidden).toBe(false);
    });

    it("can start collapsed", () => {
        const panel = new LayerPanel(fakeSources(), { collapsed: true });
        expect(panel.collapsed).toBe(true);
    });

    it("adds the URLs in the form and closes it", async () => {
        const t = setup();
        t.$<HTMLButtonElement>(".mc-add").click();
        t.$<HTMLTextAreaElement>("textarea").value =
            " a.tif\n\nhttps://x/b.tif ";
        const result = await t.panel.submit();
        expect(t.sources.add).toHaveBeenCalledWith([
            "a.tif",
            "https://x/b.tif",
        ]);
        expect(result.added).toHaveLength(2);
        expect(t.onAdded).toHaveBeenCalledWith(["a.tif", "https://x/b.tif"]);
        expect(t.$<HTMLFormElement>(".mc-add-form").hidden).toBe(true);
    });

    it("keeps failed URLs in the form with their errors", async () => {
        const t = setup();
        t.$<HTMLButtonElement>(".mc-add").click();
        const box = t.$<HTMLTextAreaElement>("textarea");
        box.value = "a.tif\nbad.tif";
        await t.panel.submit();
        expect(box.value).toBe("bad.tif");
        expect(t.$(".mc-status").textContent).toBe("bad.tif: 404");
        expect(t.$<HTMLFormElement>(".mc-add-form").hidden).toBe(false);
        expect(t.onAdded).toHaveBeenCalledWith(["a.tif"]);
    });

    it("shows an unexpected add failure instead of throwing", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const t = setup();
        t.sources.add.mockRejectedValueOnce(new Error("WebGL lost"));
        t.$<HTMLButtonElement>(".mc-add").click();
        t.$<HTMLTextAreaElement>("textarea").value = "a.tif";
        const result = await t.panel.submit();
        expect(result.errors).toEqual([{ url: "a.tif", error: "WebGL lost" }]);
        expect(t.$(".mc-status").textContent).toBe("a.tif: WebGL lost");
        expect(t.$<HTMLButtonElement>('button[type="submit"]').disabled).toBe(
            false,
        );
        expect(t.onAdded).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it("asks for a URL when the form is empty", async () => {
        const t = setup();
        await t.panel.submit();
        expect(t.sources.add).not.toHaveBeenCalled();
        expect(t.$(".mc-status").textContent).toMatch("at least one URL");
    });

    it("submits from the form's submit event", () => {
        const t = setup();
        t.$<HTMLTextAreaElement>("textarea").value = "a.tif";
        t.$<HTMLFormElement>(".mc-add-form").dispatchEvent(
            new Event("submit", { cancelable: true }),
        );
        expect(t.sources.add).toHaveBeenCalledWith(["a.tif"]);
    });
});

describe("parseUrls", () => {
    it("splits on any whitespace and drops blanks", () => {
        expect(parseUrls("a.tif  b.tif\n\n c.tif\t")).toEqual([
            "a.tif",
            "b.tif",
            "c.tif",
        ]);
    });
});
