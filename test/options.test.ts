import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECTION, resolveOptions } from "../src/options.js";
import type { MapOptions } from "../src/options.js";

afterEach(() => vi.restoreAllMocks());

describe("resolveOptions", () => {
    it.each([undefined, null, {}])(
        "gives an empty eqc map for %j",
        (options) => {
            expect(resolveOptions(options)).toEqual({
                projection: "eqc",
                sources: [],
                display: {},
            });
            expect(DEFAULT_PROJECTION).toBe("eqc");
        },
    );

    it("treats null fields as omitted", () => {
        const options = { projection: null, sources: null, display: null };
        expect(resolveOptions(options as unknown as MapOptions)).toEqual({
            projection: "eqc",
            sources: [],
            display: {},
        });
    });

    it("keeps given options", () => {
        const options: MapOptions = {
            projection: "moll",
            sources: ["a.tif"],
            display: { min: 0, max: 1 },
        };
        expect(resolveOptions(options)).toEqual(options);
    });

    it.each([
        ["eqc", "options must be an object (or omitted)"],
        [["a.tif"], "options must be an object (or omitted)"],
        [{ sources: "a.tif" }, "`sources` must be an array of URLs"],
        [{ sources: [1] }, "`sources` must be an array of URLs"],
        [{ display: "gray" }, "`display` must be an object"],
        [
            { display: { min: 1, max: 0 } },
            "Invalid display config: max must be greater than min",
        ],
        [
            { display: { bands: [70000] } },
            "Invalid display config: band 70000 is not in 1..65535",
        ],
    ])("rejects %j", (options, message) => {
        // Deliberately invalid, as a JS caller could pass
        expect(() => resolveOptions(options as unknown as MapOptions)).toThrow(
            message,
        );
    });

    it("warns that `body` is ignored", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        resolveOptions({ body: "mars" } as MapOptions);
        expect(warn).toHaveBeenCalledWith(
            expect.stringMatching("`body` is ignored"),
        );
    });
});
