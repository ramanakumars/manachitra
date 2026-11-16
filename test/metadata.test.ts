import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the network/parsing libraries: readMeta's own logic is what's tested.
vi.mock("geotiff", () => ({ fromUrl: vi.fn() }));
vi.mock("geotiff-geokeys-to-proj4", () => ({ toProj4: vi.fn() }));

const { fromUrl } = vi.mocked(await import("geotiff"));
const { toProj4 } = vi.mocked(await import("geotiff-geokeys-to-proj4"));
const { mapLimit, readAllMeta, readMeta } = await import("../src/metadata.js");

const DEF = "+proj=laea +lat_0=0 +lon_0=0 +a=71492000 +b=66854000 +no_defs";

type Tiff = Awaited<ReturnType<typeof fromUrl>>;
type Image = Awaited<ReturnType<Tiff["getImage"]>>;
type Proj4Result = ReturnType<typeof toProj4>;

/** A geotiff.js-like image with sensible defaults. */
function fakeImage(overrides: Partial<Record<keyof Image, unknown>> = {}) {
    return {
        getSamplesPerPixel: () => 15,
        getBitsPerSample: () => 32,
        getSampleFormat: () => 3,
        getGDALNoData: () => null,
        getGDALMetadata: () => null,
        getGeoKeys: () => ({}),
        getBoundingBox: () => [-8e6, -8e6, 8e6, 8e6],
        getResolution: () => [62500, -62500, 0],
        getWidth: () => 256,
        getHeight: () => 256,
        ...overrides,
    };
}

/** A geotiff.js-like file whose first image is `image`. */
const fakeTiff = (image: object) =>
    ({ getImage: async () => image }) as unknown as Tiff;

function serve(image: object) {
    fromUrl.mockResolvedValue(fakeTiff(image));
}

/** toProj4's result; only the fields readMeta uses. */
const proj4Result = (r: {
    proj4: string;
    errors: object;
    conversionParameters?: { x: number; y: number; z: number };
}) =>
    ({
        conversionParameters: { x: 1, y: 1, z: 1 },
        ...r,
    }) as Proj4Result;

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    toProj4.mockReturnValue(
        proj4Result({ proj4: DEF, errors: { bothGCSAndPCSAreSet: true } }),
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("readMeta", () => {
    it("returns CRS, bounds, resolution and band info", async () => {
        serve(fakeImage({ getGDALNoData: () => NaN }));
        const meta = await readMeta("a.tif");
        expect(meta).toEqual({
            url: "a.tif",
            def: DEF,
            bounds: [-8e6, -8e6, 8e6, 8e6],
            resolution: 62500,
            width: 256,
            height: 256,
            bandCount: 15,
            nodata: NaN,
        });
    });

    it("treats bothGCSAndPCSAreSet as informational", async () => {
        serve(fakeImage());
        await readMeta("a.tif");
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("warns about other GeoKey issues but still reads the file", async () => {
        serve(fakeImage());
        toProj4.mockReturnValue(
            proj4Result({ proj4: DEF, errors: { someKey: "odd" } }),
        );
        await expect(readMeta("a.tif")).resolves.toMatchObject({ def: DEF });
        expect(console.warn).toHaveBeenCalled();
    });

    it("rejects a file with no usable CRS", async () => {
        serve(fakeImage());
        toProj4.mockReturnValue(proj4Result({ proj4: "", errors: {} }));
        await expect(readMeta("a.tif")).rejects.toThrow(
            "a.tif: no usable CRS in GeoKeys",
        );
    });

    it("rejects a file with no GeoKeys", async () => {
        serve(fakeImage({ getGeoKeys: () => null }));
        await expect(readMeta("a.tif")).rejects.toThrow("a.tif: no GeoKeys");
    });

    it.each([
        ["feet", 0.3048],
        ["km", 1000],
    ])("rejects a file whose coordinates are in %s", async (_, factor) => {
        serve(fakeImage());
        toProj4.mockReturnValue(
            proj4Result({
                proj4: DEF,
                errors: {},
                conversionParameters: { x: factor, y: factor, z: 1 },
            }),
        );
        await expect(readMeta("a.tif")).rejects.toThrow(
            /units need conversion/,
        );
    });

    it("logs the embedded GDAL metadata, not a pending promise", async () => {
        const stats = { STATISTICS_MAXIMUM: "1" };
        serve(fakeImage({ getGDALMetadata: async () => stats }));
        await readMeta("a.tif");
        expect(console.log).toHaveBeenCalledWith(
            "a.tif",
            expect.objectContaining({ stats }),
        );
    });
});

describe("readAllMeta", () => {
    it("drops unreadable files and keeps the rest", async () => {
        fromUrl.mockImplementation(async (url) => {
            if (url === "bad.tif") throw new Error("404");
            return fakeTiff(fakeImage());
        });
        const metas = await readAllMeta(["a.tif", "bad.tif", "b.tif"]);
        expect(metas.map((m) => m.url)).toEqual(["a.tif", "b.tif"]);
        expect(console.error).toHaveBeenCalledWith(
            "bad.tif",
            expect.any(Error),
        );
    });
});

describe("mapLimit", () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it("keeps input order regardless of completion order", async () => {
        const out = await mapLimit([30, 10, 20], 3, async (ms) => {
            await delay(ms);
            return ms;
        });
        expect(out).toEqual([30, 10, 20]);
    });

    it("never runs more than `limit` calls at once", async () => {
        let running = 0;
        let peak = 0;
        await mapLimit(
            Array.from({ length: 20 }, (_, i) => i),
            4,
            async () => {
                peak = Math.max(peak, ++running);
                await delay(1);
                running--;
            },
        );
        expect(peak).toBe(4);
    });

    it("still makes progress with a limit below 1", async () => {
        await expect(mapLimit([1, 2], 0, async (x) => x * 2)).resolves.toEqual([
            2, 4,
        ]);
    });

    it("returns an empty array for no items", async () => {
        await expect(mapLimit([], 8, async (x) => x)).resolves.toEqual([]);
    });
});
