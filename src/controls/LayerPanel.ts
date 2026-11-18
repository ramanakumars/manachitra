// Layers panel (right side, under the toolbar): lists the files on the map,
// topmost first, each with a visibility checkbox and a remove button. The
// "+" button opens a form for COG URLs (one per line). The header collapses
// the panel to a single row.
import Control from "ol/control/Control.js";
import type { AddResult, SourceEntry, SourceManager } from "../sources.js";
import { el } from "./dom.js";

/** The SourceManager methods the panel uses. */
export type LayerSource = Pick<
    SourceManager,
    "entries" | "add" | "remove" | "setVisible" | "onChange"
>;

export interface LayerPanelOptions {
    /** Element to render into (default: the map's control container). */
    target?: HTMLElement;
    /** Start collapsed. */
    collapsed?: boolean;
    /** Called with the URLs that were added (e.g. to zoom to them). */
    onAdded?: (urls: string[]) => void;
}

/** Characters of a file name that are never truncated (see item()). */
const TAIL = 10;

/** Split pasted text into URLs (one per line; any whitespace separates). */
export const parseUrls = (text: string): string[] =>
    text.split(/\s+/).filter(Boolean);

export class LayerPanel extends Control {
    /** The panel's DOM node (OL's `element`, which is protected and nullable). */
    readonly root: HTMLDivElement;
    private readonly sources: LayerSource;
    private readonly onAdded?: (urls: string[]) => void;
    private readonly unsubscribe: () => void;
    private readonly toggle: HTMLButtonElement;
    private readonly addButton: HTMLButtonElement;
    private readonly form: HTMLFormElement;
    private readonly urls: HTMLTextAreaElement;
    private readonly submitButton: HTMLButtonElement;
    private readonly status: HTMLDivElement;
    private readonly list: HTMLUListElement;

    constructor(
        sources: LayerSource,
        { target, collapsed = false, onAdded }: LayerPanelOptions = {},
    ) {
        const element = el("div", {
            className: "mc-panel ol-unselectable ol-control",
        });
        super({ element, target });
        this.root = element;
        this.sources = sources;
        this.onAdded = onAdded;

        this.toggle = el("button", {
            type: "button",
            className: "mc-panel-title",
        });
        this.addButton = el("button", {
            type: "button",
            className: "mc-add",
            textContent: "+",
            title: "Add COG layers",
        });
        this.addButton.setAttribute("aria-label", "Add COG layers");
        const header = el("div", { className: "mc-panel-header" }, [
            this.toggle,
            this.addButton,
        ]);

        this.urls = el("textarea", {
            rows: 3,
            placeholder: "COG URLs, one per line",
            spellcheck: false,
        });
        this.urls.setAttribute("aria-label", "COG URLs, one per line");
        this.submitButton = el("button", {
            type: "submit",
            textContent: "Add",
        });
        const cancel = el("button", { type: "button", textContent: "Cancel" });
        this.status = el("div", { className: "mc-status", role: "status" });
        this.form = el("form", { className: "mc-add-form", hidden: true }, [
            this.urls,
            el("div", { className: "mc-buttons" }, [this.submitButton, cancel]),
            this.status,
        ]);

        this.list = el("ul", { className: "mc-layer-list" });
        element.append(header, this.form, this.list);

        this.toggle.addEventListener("click", () =>
            this.setCollapsed(!this.collapsed),
        );
        this.addButton.addEventListener("click", () => this.openForm());
        cancel.addEventListener("click", () => this.closeForm());
        this.form.addEventListener("submit", (event) => {
            event.preventDefault();
            void this.submit();
        });
        this.urls.addEventListener("keydown", (event) => {
            // Ctrl/Cmd+Enter submits; plain Enter adds a line.
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void this.submit();
            }
            if (event.key === "Escape") this.closeForm();
        });

        this.setCollapsed(collapsed);
        this.renderList(sources.entries);
        this.unsubscribe = sources.onChange((entries) =>
            this.renderList(entries),
        );
    }

    /** Stop listening to the sources when OL disposes the control. */
    protected override disposeInternal(): void {
        this.unsubscribe();
        super.disposeInternal();
    }

    get collapsed(): boolean {
        return this.root.classList.contains("mc-collapsed");
    }

    /** Hide the form and list, leaving the header (and its "+") visible. */
    setCollapsed(collapsed: boolean): void {
        this.root.classList.toggle("mc-collapsed", collapsed);
        this.toggle.setAttribute("aria-expanded", String(!collapsed));
        this.toggle.title = collapsed ? "Show layers" : "Hide layers";
        this.renderTitle();
    }

    /** Show the add form (expanding the panel) and focus it. */
    openForm(): void {
        this.setCollapsed(false);
        this.form.hidden = false;
        this.urls.focus();
    }

    closeForm(): void {
        this.form.hidden = true;
        this.status.textContent = "";
    }

    /**
     * Add the URLs in the form. On success the form closes; failed URLs stay
     * in the box with their errors listed below it.
     */
    async submit(): Promise<AddResult> {
        const urls = parseUrls(this.urls.value);
        if (!urls.length) {
            this.status.textContent = "Enter at least one URL.";
            return { added: [], errors: [] };
        }
        this.setBusy(true, urls.length);
        let result: AddResult;
        try {
            result = await this.sources.add(urls);
        } catch (e) {
            // File problems come back in `errors`; this is anything else.
            const error = e instanceof Error ? e.message : String(e);
            console.error(e);
            result = { added: [], errors: urls.map((url) => ({ url, error })) };
        } finally {
            this.setBusy(false);
        }
        const { added, errors } = result;
        this.urls.value = errors.map((e) => e.url).join("\n");
        this.status.replaceChildren(
            ...errors.map((e) =>
                el("div", {
                    className: "mc-error",
                    textContent: `${e.url}: ${e.error}`,
                }),
            ),
        );
        if (!errors.length) this.closeForm();
        if (added.length) this.onAdded?.(added);
        return result;
    }

    private setBusy(busy: boolean, n = 0): void {
        this.submitButton.disabled = busy;
        this.urls.readOnly = busy;
        if (busy) {
            this.status.textContent = `Reading ${n} file${n === 1 ? "" : "s"}…`;
        }
    }

    private renderTitle(): void {
        const n = this.sources.entries.length;
        this.toggle.textContent = `${this.collapsed ? "▸" : "▾"} Layers (${n})`;
    }

    /** Rebuild the list, topmost layer first. */
    private renderList(entries: readonly SourceEntry[]): void {
        this.renderTitle();
        if (!entries.length) {
            this.list.replaceChildren(
                el("li", {
                    className: "mc-empty",
                    textContent: "No layers. Add COG URLs with +.",
                }),
            );
            return;
        }
        this.list.replaceChildren(
            ...[...entries].reverse().map((e) => this.item(e)),
        );
    }

    private item(entry: SourceEntry): HTMLLIElement {
        const outside = entry.layer === null;
        const checkbox = el("input", {
            type: "checkbox",
            checked: entry.visible,
            title: entry.visible ? "Hide layer" : "Show layer",
        });
        checkbox.addEventListener("change", () =>
            this.sources.setVisible(entry.url, checkbox.checked),
        );
        // Tiled datasets differ only at the end of the name
        // ("..._000340.tif"), so long names are cut in the middle: the head
        // shrinks with an ellipsis, the tail always shows.
        const cut = Math.max(0, entry.name.length - TAIL);
        const name = el(
            "span",
            {
                className: "mc-layer-name",
                title: outside
                    ? `${entry.url}\nOutside the view projection's extent`
                    : entry.url,
            },
            [
                el("span", {
                    className: "mc-name-head",
                    textContent: entry.name.slice(0, cut),
                }),
                el("span", {
                    className: "mc-name-tail",
                    textContent: entry.name.slice(cut),
                }),
            ],
        );
        const label = el("label", { className: "mc-layer-label" }, [
            checkbox,
            name,
        ]);
        if (outside) {
            label.append(
                el("span", {
                    className: "mc-note",
                    textContent: "not in view",
                }),
            );
        }
        const remove = el("button", {
            type: "button",
            className: "mc-remove",
            textContent: "×",
            title: `Remove ${entry.name}`,
        });
        remove.setAttribute("aria-label", `Remove ${entry.name}`);
        remove.addEventListener("click", () => this.sources.remove(entry.url));
        return el(
            "li",
            { className: `mc-layer${outside ? " mc-outside" : ""}` },
            [label, remove],
        );
    }
}
