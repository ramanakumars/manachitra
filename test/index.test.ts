import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapOptions } from "../src/index.js";

// buildMap's network and WebGL parts can't run here; these tests cover the
// argument validation and failure paths that run before them.
vi.mock("../src/metadata.js", () => ({ readAllMeta: vi.fn() }));

const { readAllMeta } = vi.mocked(await import("../src/metadata.js"));
const { buildMap } = await import("../src/index.js");

const ok = { body: "jupiter", projection: "eqc", sources: ["a.tif"] };

beforeEach(() => {
    readAllMeta.mockReset();
});

describe("buildMap", () => {
    it.each([
        [{ ...ok, sources: "a.tif" }, "`sources` must be an array of URLs"],
        [{ ...ok, body: "pluto" }, 'Unknown body "pluto"'],
        [{ ...ok, projection: "lcc" }, 'Unknown projection "lcc"'],
        [
            { ...ok, display: { min: 1, max: 0 } },
            "Invalid display config: max must be greater than min",
        ],
    ])(
        "rejects bad arguments before reading any file (%#)",
        async (opts, msg) => {
            // Some are deliberately invalid, as a JS caller could pass
            await expect(buildMap("map", opts as MapOptions)).rejects.toThrow(
                msg,
            );
            expect(readAllMeta).not.toHaveBeenCalled();
        },
    );

    it("says so when none of the sources could be read", async () => {
        readAllMeta.mockResolvedValue([]);
        await expect(
            buildMap("map", { ...ok, display: { bands: [4, 3, 2] } }),
        ).rejects.toThrow("None of the 1 sources could be read (see console)");
    });
});
