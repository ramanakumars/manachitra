// Small DOM builders shared by the controls.

type Tag = keyof HTMLElementTagNameMap;

export function el<K extends Tag>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> = {},
    children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...children);
    return e;
}

/** <select> from [value, label] pairs (or plain values). */
export function select(
    options: readonly (string | number | readonly [string, string])[],
    title: string,
): HTMLSelectElement {
    const s = el("select", { title });
    for (const o of options) {
        const [value, label] = Array.isArray(o) ? o : [o, o];
        s.append(
            el("option", { value: String(value), textContent: String(label) }),
        );
    }
    return s;
}

/** A labelled row: muted label text followed by the inputs. */
export function field(
    label: string,
    ...inputs: HTMLElement[]
): HTMLLabelElement {
    const text = el("span", { className: "mc-label", textContent: label });
    return el("label", { className: "mc-field" }, [text, ...inputs]);
}
