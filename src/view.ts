// Which body and view projection the map shows. Like DisplayController, one
// object holds the state, validates changes and notifies listeners. The
// projection is the user's choice (ViewBar); the body is read from the files
// (SourceManager sets it from the first file added to an empty map).
import { sameBody } from "./bodies.js";
import type { Body } from "./bodies.js";
import { viewCrs } from "./projections.js";
import type { ProjectionName, ProjectionRef, ViewCrs } from "./projections.js";

/**
 * Nominal sphere for the view before any file has told us the body. Only
 * angles are shown then (no data, grid in degrees), so its size is arbitrary.
 */
export const NO_BODY: Body = {
    name: "No body",
    code: "NOBODY",
    a: 1e6,
    b: 1e6,
};

export interface ViewState {
    /** Body of the files, or null until a file has been read. */
    body: Body | null;
    projection: ProjectionName;
    /** View CRS of `body` (NO_BODY if null) in `projection`. */
    view: ViewCrs;
}

export interface ViewChange {
    /** A body (e.g. from detectBody), or null for none. */
    body?: Body | null;
    projection?: ProjectionRef;
}

export class ViewController {
    readonly listeners = new Set<(state: ViewState) => void>();
    private current: ViewState;

    /** Throws on an unknown projection (as buildMap must). */
    constructor(projection: ProjectionRef, body: Body | null = null) {
        this.current = resolve(body, projection);
    }

    /** The current state. Change it with update(). */
    get state(): Readonly<ViewState> {
        return this.current;
    }

    /**
     * Subscribe to successful changes (listeners run in subscription order).
     * @returns Unsubscribe.
     */
    onChange(fn: (state: ViewState) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /**
     * Switch body and/or projection (omitted fields are kept).
     * @returns Error message (state unchanged), or null. Listeners only run
     *   when the body or projection actually changes.
     */
    update(changes: ViewChange): string | null {
        let next: ViewState;
        try {
            next = resolve(
                changes.body === undefined ? this.current.body : changes.body,
                changes.projection ?? this.current.projection,
            );
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
        const prev = this.current;
        if (
            sameBody(next.body, prev.body) &&
            next.projection === prev.projection
        ) {
            return null;
        }
        this.current = next;
        this.listeners.forEach((fn) => fn(next));
        return null;
    }
}

function resolve(body: Body | null, projection: ProjectionRef): ViewState {
    const view = viewCrs(body ?? NO_BODY, projection);
    // viewCrs accepted it, so it's a PROJECTIONS key
    const key = String(projection).toLowerCase() as ProjectionName;
    return { body, projection: key, view };
}
