// Minimal CPU evaluator for the subset of OL WebGL style expressions that
// src/style.ts emits, so tests can check what colour a pixel gets rather than
// the shape of the expression. Semantics follow ol/expr/gpu.js:
//   interpolate: piecewise linear, clamped to the first/last output
//   palette:     nearest entry at index + 0.5 (texture lookup)

export interface EvalContext {
    /** Band values, 1-based via bands[n - 1]. */
    bands: number[];
    vars: Record<string, number>;
}

/**
 * @param expr OL expression.
 * @returns number, boolean or [r, g, b, a].
 */
export function evaluate(expr: unknown, ctx: EvalContext): unknown {
    if (!Array.isArray(expr)) return expr;
    const [op, ...args] = expr;
    const ev = (e: unknown) => evaluate(e, ctx);
    const num = (e: unknown) => ev(e) as number;
    switch (op) {
        case "var":
            return ctx.vars[args[0]];
        case "band":
            return ctx.bands[num(args[0]) - 1];
        case "+":
            return num(args[0]) + num(args[1]);
        case "-":
            return num(args[0]) - num(args[1]);
        case "*":
            return num(args[0]) * num(args[1]);
        case "/":
            return num(args[0]) / num(args[1]);
        case "clamp":
            return Math.min(Math.max(num(args[0]), num(args[1])), num(args[2]));
        case "==":
            return ev(args[0]) === ev(args[1]);
        case "case": {
            for (let i = 0; i < args.length - 1; i += 2) {
                if (ev(args[i])) return ev(args[i + 1]);
            }
            return ev(args[args.length - 1]);
        }
        case "array":
            return args.map(ev);
        case "interpolate": {
            const [, input, ...stops] = args;
            const x = num(input);
            const xs: number[] = [];
            const ys: number[] = [];
            for (let i = 0; i < stops.length; i += 2) {
                xs.push(num(stops[i]));
                ys.push(num(stops[i + 1]));
            }
            if (x <= xs[0]) return ys[0];
            for (let i = 1; i < xs.length; i++) {
                if (x <= xs[i]) {
                    const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
                    return ys[i - 1] + f * (ys[i] - ys[i - 1]);
                }
            }
            return ys[ys.length - 1];
        }
        case "palette": {
            const [index, colors] = args as [unknown, unknown[]];
            const i = Math.floor(num(index) + 0.5);
            return colors[Math.min(Math.max(i, 0), colors.length - 1)];
        }
        default:
            // A 4-number literal is a colour, e.g. [0, 0, 0, 0].
            if (typeof op === "number") return expr;
            throw new Error(`evaluate: unsupported operator ${op}`);
    }
}
