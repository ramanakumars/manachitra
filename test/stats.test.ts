import { describe, expect, it } from "vitest";
import { percentileRange, validValues } from "../src/stats.js";

describe("validValues", () => {
    it("drops NaN, infinities and nodata", () => {
        const data = [1, NaN, 2, Infinity, -9999, 3, -Infinity];
        expect([...validValues(data, [-9999])]).toEqual([1, 2, 3]);
    });

    it("subsamples evenly to at most `max` values", () => {
        const data = Float32Array.from({ length: 1000 }, (_, i) => i);
        const out = validValues(data, [], 100);
        expect(out).toHaveLength(100);
        expect(out[0]).toBe(0);
        expect(out[99]).toBe(990);
    });
});

describe("percentileRange", () => {
    const ramp = Float64Array.from({ length: 101 }, (_, i) => i); // 0..100

    it("clips to the 2nd and 98th percentiles by default", () => {
        expect(percentileRange([ramp])).toEqual([2, 98]);
    });

    it("pools every sample array (files and RGB bands)", () => {
        const low = Float64Array.from({ length: 50 }, (_, i) => i);
        const high = Float64Array.from({ length: 51 }, (_, i) => 50 + i);
        expect(percentileRange([high, low], [0, 100])).toEqual([0, 100]);
    });

    it("ignores outliers that plain min/max would use", () => {
        // the aurora: mostly 0-4, a few pixels up to 572
        const aurora = Float64Array.from({ length: 1000 }, (_, i) =>
            i < 5 ? 572 : (i % 40) / 10,
        );
        const [min, max] = percentileRange([aurora])!;
        expect(min).toBe(0);
        expect(max).toBeLessThan(4);
    });

    it("uses positive values only for log scale", () => {
        const data = Float64Array.from([-5, 0, 0, 0, 1, 10, 100]);
        expect(percentileRange([data], [0, 100], true)).toEqual([1, 100]);
    });

    it("widens a constant range so max > min", () => {
        const [min, max] = percentileRange([Float64Array.from([7, 7, 7])])!;
        expect(min).toBe(7);
        expect(max).toBeGreaterThan(7);
    });

    it("returns null with no values", () => {
        expect(percentileRange([])).toBeNull();
        expect(percentileRange([new Float64Array()])).toBeNull();
        expect(
            percentileRange([Float64Array.from([-1])], [2, 98], true),
        ).toBeNull();
    });
});
