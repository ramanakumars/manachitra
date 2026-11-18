import { describe, expect, it, vi } from "vitest";
import { BODIES } from "../src/bodies.js";
import { NO_BODY, ViewController } from "../src/view.js";

describe("ViewController", () => {
    it("starts with no body, on a nominal sphere", () => {
        const v = new ViewController("EQC");
        expect(v.state.body).toBeNull();
        expect(v.state.projection).toBe("eqc");
        expect(v.state.view.code).toBe(`${NO_BODY.code}:EQC`);
    });

    it("throws on an unknown projection", () => {
        expect(() => new ViewController("lcc")).toThrow(
            'Unknown projection "lcc"',
        );
    });

    it("switches body and projection and notifies listeners", () => {
        const v = new ViewController("eqc");
        const fn = vi.fn();
        v.onChange(fn);
        expect(v.update({ body: BODIES.mars })).toBeNull();
        expect(v.state.view.code).toBe("MARS:EQC");
        expect(v.update({ projection: "npstere" })).toBeNull();
        expect(v.state.view.code).toBe("MARS:NPSTERE");
        expect(v.state.body).toBe(BODIES.mars); // kept when omitted
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith(v.state);
    });

    it("can go back to no body", () => {
        const v = new ViewController("moll", BODIES.jupiter);
        v.update({ body: null });
        expect(v.state.body).toBeNull();
        expect(v.state.view.code).toBe(`${NO_BODY.code}:MOLL`);
    });

    it("doesn't notify when nothing changes", () => {
        const v = new ViewController("eqc", BODIES.jupiter);
        const fn = vi.fn();
        v.onChange(fn);
        expect(
            v.update({ body: { ...BODIES.jupiter }, projection: "EQC" }),
        ).toBeNull();
        expect(v.update({})).toBeNull();
        expect(fn).not.toHaveBeenCalled();
    });

    it("returns an error and keeps the state on bad input", () => {
        const v = new ViewController("eqc", BODIES.jupiter);
        const fn = vi.fn();
        v.onChange(fn);
        expect(v.update({ projection: "lcc" })).toMatch(
            'Unknown projection "lcc"',
        );
        expect(v.state.view.code).toBe("JUP:EQC");
        expect(fn).not.toHaveBeenCalled();
    });

    it("unsubscribes", () => {
        const v = new ViewController("eqc");
        const fn = vi.fn();
        v.onChange(fn)();
        v.update({ body: BODIES.saturn });
        expect(fn).not.toHaveBeenCalled();
    });
});
