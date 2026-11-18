// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BODIES } from "../src/bodies.js";
import { PROJECTIONS } from "../src/projections.js";
import { ViewController } from "../src/view.js";
import { ViewBar } from "../src/controls/ViewBar.js";

function setup(projection = "eqc") {
    const controller = new ViewController(projection);
    const bar = new ViewBar(controller);
    const selects = bar.root.querySelectorAll("select");
    const body = bar.root.querySelector(".mc-body")!;
    const error = bar.root.querySelector(".mc-error")!;
    return { controller, bar, selects, body, error, projSelect: selects[0] };
}

function change(input: HTMLSelectElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("change"));
}

describe("ViewBar", () => {
    it("has a projection picker only; the body is read-only text", () => {
        const t = setup();
        expect(t.selects).toHaveLength(1);
        expect([...t.projSelect.options].map((o) => [o.value, o.text])).toEqual(
            Object.entries(PROJECTIONS).map(([k, p]) => [k, p.label]),
        );
        expect(t.body.tagName).toBe("SPAN");
    });

    it("shows a placeholder until the files set a body", () => {
        const t = setup("SPSTERE");
        expect(t.projSelect.value).toBe("spstere");
        expect(t.body.textContent).toBe("–");
        t.controller.update({ body: BODIES.mars });
        expect(t.body.textContent).toBe("Mars");
    });

    it("sends projection edits to the controller", () => {
        const t = setup();
        t.controller.update({ body: BODIES.mars });
        change(t.projSelect, "moll");
        expect(t.controller.state.view.code).toBe("MARS:MOLL");
        expect(t.error.textContent).toBe("");
    });

    it("reflects programmatic updates", () => {
        const t = setup();
        t.controller.update({ projection: "npstere" });
        expect(t.projSelect.value).toBe("npstere");
    });

    it("shows controller errors", () => {
        const t = setup();
        const bogus = document.createElement("option");
        bogus.value = "lcc";
        t.projSelect.append(bogus);
        change(t.projSelect, "lcc");
        expect(t.error.textContent).toMatch('Unknown projection "lcc"');
        expect(t.bar.root.classList.contains("mc-has-error")).toBe(true);
        expect(t.controller.state.projection).toBe("eqc");
    });
});
