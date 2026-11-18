// Value ranges for the auto stretch, from a sample of each file's pixels.
// The files carry no embedded statistics, so values are read from the
// smallest overview (cheap for COGs): ~20k–300k pixels for the sample data.
import { fromUrl, Pool } from "geotiff";

type GeoTIFFImage = Awaited<
    ReturnType<Awaited<ReturnType<typeof fromUrl>>["getImage"]>
>;

/** Percentiles the auto stretch clips to (like GDAL/QGIS cumulative cut). */
export const AUTO_PERCENTILES = [2, 98] as const;

/** Images up to this many pixels are read whole; larger ones by window. */
export const MAX_SAMPLE_PIXELS = 1024 * 1024;

/** Values kept per file and band (evenly subsampled beyond this). */
export const MAX_SAMPLES = 32768;

/**
 * The usable values of one band: finite and not a nodata value, evenly
 * subsampled to at most `max` values.
 */
export function validValues(
    data: ArrayLike<number>,
    nodata: readonly number[] = [],
    max = MAX_SAMPLES,
): Float64Array {
    const out: number[] = [];
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (Number.isFinite(v) && !nodata.includes(v)) out.push(v);
    }
    if (out.length <= max) return Float64Array.from(out);
    const step = out.length / max;
    return Float64Array.from(
        { length: max },
        (_, i) => out[Math.floor(i * step)],
    );
}

/**
 * Low/high percentiles over all samples pooled (nearest rank).
 * @param positiveOnly Use only values > 0 (log scale).
 * @returns [min, max] with max > min, or null if there are no values.
 */
export function percentileRange(
    samples: readonly ArrayLike<number>[],
    [low, high]: readonly [number, number] = AUTO_PERCENTILES,
    positiveOnly = false,
): [number, number] | null {
    const pooled: number[] = [];
    for (const s of samples) {
        for (let i = 0; i < s.length; i++) {
            if (!positiveOnly || s[i] > 0) pooled.push(s[i]);
        }
    }
    if (!pooled.length) return null;
    const sorted = Float64Array.from(pooled).sort();
    const at = (p: number) =>
        sorted[Math.round((p / 100) * (sorted.length - 1))];
    const min = at(low);
    let max = at(high);
    // Constant data: widen slightly so the stretch is valid (max > min).
    if (!(max > min)) max = min + Math.max(Math.abs(min) * 1e-3, 1e-9);
    return [min, max];
}

let pool: Pool | undefined;
/**
 * Decoder workers, so sampling compressed data doesn't block the page
 * (geotiff.js decodes on the calling thread without a pool). Pixel-
 * interleaved files decode every band to read one: sampling band 1 of the
 * 150-band aurora takes seconds. None outside browsers (no Worker).
 */
function decoderPool(): Pool | undefined {
    if (typeof Worker === "undefined") return undefined;
    pool ??= new Pool();
    return pool;
}

/** GDAL internal masks are extra IFDs; skip them like OL does. */
const isMask = (image: GeoTIFFImage): boolean =>
    (Number(image.fileDirectory.getValue("NewSubfileType") ?? 0) & 4) === 4;

/**
 * Sample `bands` (1-based) of a COG. Tries images from the smallest
 * overview up: read whole while they're at most MAX_SAMPLE_PIXELS, moving to
 * the next size only if a band has no valid values (sparse files can have
 * all-NaN coarse overviews). An image larger than that is read as a centred
 * window, so a file without overviews costs one window, not the whole file.
 * @param nodata Values to ignore besides NaN/±Infinity.
 * @returns One array of valid values per band (empty if none were found).
 */
export async function sampleFile(
    url: string,
    bands: readonly number[],
    nodata: readonly number[] = [],
): Promise<Float64Array[]> {
    const tiff = await fromUrl(url);
    const count = await tiff.getImageCount();
    const images = (
        await Promise.all(
            Array.from({ length: count }, (_, i) => tiff.getImage(i)),
        )
    )
        .filter((image) => !isMask(image))
        .sort(
            (a, b) =>
                a.getWidth() * a.getHeight() - b.getWidth() * b.getHeight(),
        );
    let values: Float64Array[] = bands.map(() => new Float64Array());
    for (const image of images) {
        const w = image.getWidth();
        const h = image.getHeight();
        const whole = w * h <= MAX_SAMPLE_PIXELS;
        const side = Math.sqrt(MAX_SAMPLE_PIXELS);
        const x0 = Math.max(0, Math.floor((w - side) / 2));
        const y0 = Math.max(0, Math.floor((h - side) / 2));
        const rasters = await image.readRasters({
            samples: bands.map((b) => b - 1),
            pool: decoderPool(),
            ...(whole
                ? {}
                : {
                      window: [
                          x0,
                          y0,
                          Math.min(w, x0 + side),
                          Math.min(h, y0 + side),
                      ],
                  }),
        });
        values = bands.map((_, i) =>
            validValues(rasters[i] as ArrayLike<number>, nodata),
        );
        if (!whole || values.every((v) => v.length)) break;
    }
    return values;
}
