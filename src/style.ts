// WebGLTile styles. Sources are read with normalize: false, so the style sees
// raw band values and does the stretch itself:
//   t = (v - min) / (max - min)            (linear)
//   t = log(v / min) / log(max / min)      (log)
// clamped to [0, 1], then coloured by a palette (gray mode) or used directly
// per channel (RGB mode).
//
// Sources read only the displayed FILE bands (sourceInfo), so the style sees
// them as OUTPUT bands 1 (gray) or 1..3 (RGB). Nodata pixels never reach the
// style: OL discards them itself, using the source's nodata mask band or, for
// reprojected sources without nodata, a coverage band it appends.
//
// min and max are style variables, so they update via
// layer.updateStyleVariables() without recompiling shaders. Mode, scale and
// colormap change the shader and need layer.setStyle().
//
// OL expressions have no `log`, so the log stretch is a piecewise-linear
// `interpolate` over LOG_STOPS + 1 geometrically spaced stops s0..sN
// (s_i = min * (max/min)^(i/N)), passed as variables.
import type { ExpressionValue } from "ol/expr/expression.js";
import type { Style } from "ol/layer/WebGLTile.js";
import { palette, PALETTE_SIZE } from "./colormaps.js";
import type { DisplayState, Scale } from "./display.js";

export const LOG_STOPS = 32;

const v = (name: string): ExpressionValue => ["var", name];

/** Style variables for a display state: min, max and log stops s0..sN. */
export function styleVariables({
    min,
    max,
    scale,
}: Pick<DisplayState, "min" | "max" | "scale">): Record<string, number> {
    const vars: Record<string, number> = { min, max };
    const logOk = scale === "log" && min > 0 && max > min;
    for (let i = 0; i <= LOG_STOPS; i++) {
        vars[`s${i}`] = logOk ? min * (max / min) ** (i / LOG_STOPS) : i;
    }
    return vars;
}

/**
 * Expression for the stretched value t in [0, 1] of one band.
 * @param band OUTPUT band number (1..3).
 */
function stretch(band: number, scale: Scale): ExpressionValue {
    const value = ["band", band];
    if (scale === "log") {
        const stops: ExpressionValue[] = [];
        for (let i = 0; i <= LOG_STOPS; i++) {
            stops.push(v(`s${i}`), i / LOG_STOPS);
        }
        return ["interpolate", ["linear"], value, ...stops];
    }
    return [
        "clamp",
        ["/", ["-", value, v("min")], ["-", v("max"), v("min")]],
        0,
        1,
    ];
}

/**
 * Build a WebGLTile style. One band = gray mode (colormap applies); three
 * bands = RGB.
 */
export function buildStyle(state: DisplayState): Style {
    let color: ExpressionValue;
    if (state.bands.length === 3) {
        color = [
            "array",
            stretch(1, state.scale),
            stretch(2, state.scale),
            stretch(3, state.scale),
            1,
        ];
    } else {
        const index = ["*", stretch(1, state.scale), PALETTE_SIZE - 1];
        color = ["palette", index, palette(state.colormap)];
    }
    return { variables: styleVariables(state), color };
}
