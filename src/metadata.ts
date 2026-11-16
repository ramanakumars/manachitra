// GeoTIFF header reads: the JS equivalent of opening each file with rasterio.
import { fromUrl } from "geotiff";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import type { Extent } from "ol/extent.js";

/** Header facts for one file. */
export interface Meta {
    url: string;
    /** proj4 string from the GeoKeys (~ rasterio `src.crs`). */
    def: string;
    /** [left, bottom, right, top] in source CRS units. */
    bounds: Extent;
    /** Pixel width in source CRS units. */
    resolution: number;
    width: number;
    height: number;
    bandCount: number;
    /** GDAL nodata value, null if none (NaN is valid). */
    nodata: number | null;
}

/** Meta plus its registered CRS code (set by buildMap via codeForSource). */
export interface SourceMeta extends Meta {
    code: string;
}

/**
 * Read one file's CRS (as a proj string), bounds, resolution and band info.
 * Throws if the file has no usable CRS, or its coordinates aren't in units
 * proj4 can use directly; readAllMeta logs and drops such files.
 */
export async function readMeta(url: string): Promise<Meta> {
    const tiff = await fromUrl(url);
    const image = await tiff.getImage(); // full-res image (overviews come after)

    const header = {
        bands: image.getSamplesPerPixel(),
        bits: image.getBitsPerSample(),
        sampleFormat: image.getSampleFormat(), // 1 uint, 2 int, 3 float
        nodata: image.getGDALNoData(),
        stats: await image.getGDALMetadata(0), // null => no embedded min/max
    };
    console.log(url, header);

    const geoKeys = image.getGeoKeys();
    if (!geoKeys) throw new Error(`${url}: no GeoKeys`);
    const { proj4: def, conversionParameters, errors } = toProj4(geoKeys);
    // bothGCSAndPCSAreSet is informational (normal for projected files)
    const issues = Object.keys(errors).filter(
        (k) => k !== "bothGCSAndPCSAreSet",
    );
    if (issues.length) console.warn(url, "geokey issues:", errors);
    if (!def) throw new Error(`${url}: no usable CRS in GeoKeys`);
    // x/y multipliers != 1 (e.g. feet, km) mean coordinates need the
    // library's convertCoordinates(), which bounds/resolution here don't
    // apply; placing them as-is is wrong.
    if (conversionParameters.x !== 1 || conversionParameters.y !== 1) {
        throw new Error(`${url}: CRS units need conversion; not supported yet`);
    }

    return {
        url,
        def, // ~ src.crs (as a proj string, not WKT)
        bounds: image.getBoundingBox(), // [left, bottom, right, top]
        resolution: image.getResolution()[0], // ~ transform.a
        width: image.getWidth(),
        height: image.getHeight(),
        bandCount: header.bands,
        nodata: header.nodata, // null if none (NaN is a valid nodata value)
    };
}

/**
 * Run fn over items with at most `limit` in flight, so hundreds of files don't
 * fire hundreds of requests at once. Failed items are logged and dropped;
 * results keep the input order.
 * @param limit Maximum concurrent calls (values below 1 act as 1).
 */
export async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const out: { value: R }[] = new Array(items.length);
    let i = 0;
    const workers = Array.from(
        { length: Math.max(1, Math.min(limit, items.length)) },
        async () => {
            while (i < items.length) {
                const idx = i++;
                try {
                    out[idx] = { value: await fn(items[idx]) };
                } catch (e) {
                    console.error(items[idx], e);
                }
            }
        },
    );
    await Promise.all(workers);
    // filter() skips the holes left by failed items
    return out.filter(Boolean).map((r) => r.value);
}

/** Read all headers, at most `limit` at a time; unreadable files are dropped. */
export const readAllMeta = (urls: string[], limit = 8): Promise<Meta[]> =>
    mapLimit(urls, limit, readMeta);
