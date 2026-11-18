// View bar (full width, top of the map): the view projection picker, and the
// body the files are on (read from them, so not editable). Edits go to the
// ViewController, and the bar re-syncs from it, so programmatic
// viewController.update() calls show up here too.
import Control from "ol/control/Control.js";
import { PROJECTIONS } from "../projections.js";
import type { ViewController, ViewState } from "../view.js";
import { el, field, select } from "./dom.js";

export class ViewBar extends Control {
    private readonly controller: ViewController;
    /** The bar's DOM node (OL's `element`, which is protected and nullable). */
    readonly root: HTMLDivElement;
    private readonly unsubscribe: () => void;
    private readonly body: HTMLSpanElement;
    private readonly projection: HTMLSelectElement;
    private readonly error: HTMLDivElement;

    constructor(controller: ViewController) {
        const element = el("div", {
            className: "mc-viewbar ol-unselectable ol-control",
        });
        super({ element });
        this.root = element;
        this.controller = controller;

        this.body = el("span", {
            className: "mc-body",
            title: "Read from the files' CRS",
        });
        this.projection = select(
            Object.entries(PROJECTIONS).map(([k, p]) => [k, p.label] as const),
            "View projection",
        );
        this.error = el("div", { className: "mc-error", role: "alert" });
        element.append(
            el("div", { className: "mc-field" }, [
                el("span", { className: "mc-label", textContent: "Body" }),
                this.body,
            ]),
            field("Projection", this.projection),
            this.error,
        );

        this.projection.addEventListener("change", () => this.submit());
        this.sync(controller.state);
        this.unsubscribe = controller.onChange((next) => this.sync(next));
    }

    /** Stop listening to the controller when OL disposes the control. */
    protected override disposeInternal(): void {
        this.unsubscribe();
        super.disposeInternal();
    }

    /** Send the projection to the controller and show any error. */
    submit(): void {
        const error = this.controller.update({
            projection: this.projection.value,
        });
        this.error.textContent = error ?? "";
        this.root.classList.toggle("mc-has-error", Boolean(error));
    }

    /** Show a view state in the bar. */
    sync(state: Readonly<ViewState>): void {
        this.body.textContent = state.body?.name ?? "–";
        this.body.classList.toggle("mc-muted", state.body === null);
        this.projection.value = state.projection;
    }
}
