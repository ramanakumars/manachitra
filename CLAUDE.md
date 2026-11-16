# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

manachitra is a browser viewer for planetary (non-Earth) raster data delivered as COGs/GeoTIFFs, built on OpenLayers + proj4js, written in TypeScript. Goal: a pyproj + matplotlib-like workflow in JS — pick a body and a view projection, read each file's CRS from its GeoKeys, display everything in one view CRS. Sample data in `public/` is Jupiter: `jupiter_aurora.tif` (1-band float, north polar stereo, values 0–572), `jupiter_aurora_all.tif` (150-band float, same grid, pixel-interleaved; every band peaks at 3–4 with ~3% valid pixels, and band 1 is all NaN in the coarsest overview) and `GRS_PJ_*` (15-band float JunoCam LAEA tiles, values ~0–1).

There is no backend: COGs are served from static hosting that must support CORS + HTTP Range requests.

## Commands

`package.json` is `"type": "module"`. There is no Vite config (tests have their own `vitest.config.ts`); Vite and Vitest transpile TS directly, and `tsc` only typechecks (`noEmit`).

- Install: `npm install`
- Dev server: `npm run dev` (serves `index.html` from the repo root); build: `npm run build`
- Tests: `npm test` (Vitest, `test/**/*.test.ts`); one file: `npx vitest run test/style.test.ts`; watch: `npm run test:watch`; coverage: `npm run coverage` (v8, `src/**`, report in `coverage/`)
- Typecheck: `npm run typecheck` (`tsc`, `tsconfig.json`: strict, `moduleResolution: bundler`, `verbatimModuleSyntax`, covers `src/`, `test/` and `*.config.ts`)
- Lint: `npm run lint` (ESLint flat config `eslint.config.ts`, loaded via `jiti`: recommended + typescript-eslint recommended + `no-var`, `prefer-const`, `eqeqeq`, `consistent-type-imports`)
- Format: `npm run format` / `npm run format:check` (local prettier 3.8.3, `.prettierrc.json` `tabWidth: 4`, the same config prettierd uses; `.prettierignore` skips `public/`, `node_modules/`, build output)
- All of lint + typecheck + format check + tests: `npm run check`. Run it before finishing a change.

## Architecture

Public API (`src/index.ts`):

```js
const map = await buildMap(target, {
    body: "jupiter", // key of BODIES, or a custom { name, code, a, b }
    projection: "eqc", // "eqc" | "moll" | "npstere" | "spstere"
    sources: ["a.tif", ...], // COG URLs
    // optional initial display state, merged onto DISPLAY:
    display: { bands, min, max, scale, colormap, nodata },
});
map.get("display").update({ min: 0, max: 1 }); // DisplayController; same path as the toolbar
```

- `index.html` — demo page; edit its `config`. Files under `public/` are referenced as `public/<name>.tif`. It reports the loaded-layer count via `map.getLayers().item(0)`, so the layer group must stay the first layer if base layers are added. Layer 1 is the lon/lat grid.
- `src/bodies.ts` — `BODIES` table (IAU 2015 radii: equatorial `a`, polar `b`, mean `R`; short `code` like `JUP`) and `getBody`. Projections use `a`/`b`; `R` is for reference only.
- `src/projections.ts` — `PROJECTIONS` (proj string + full extent per body ellipsoid, `global` flag, `worldExtent` lon/lat range) and `viewCrs(body, name)` → `{ code, def, extent, global, worldExtent }`; view code is `<BODY>:<PROJ>`, e.g. `JUP:EQC`.
- `src/crs.ts` — proj4/OL registry: `defineView`, `codeForSource` (one `<BODY>:SRC:<n>` code per distinct normalised proj string), `registerAll` (single `register(proj4)` + view extent/global/worldExtent), `footprintInView`.
- `src/metadata.ts` — `readMeta` (geotiff.js header + `toProj4` GeoKeys, logs a header dump), `mapLimit`/`readAllMeta` (≤ 8 concurrent, failed files dropped).
- `src/display.ts` — `DISPLAY` defaults, `SCALES`, `validateDisplay`, `sourceInfo` (per-source `{url, bands, nodata?}`), and `DisplayController`, which holds the shared state, validates `update(changes)` (returns an error string or `null`) and applies it to every layer. Layers register with `addLayer(layer, makeSource)`, so the controller can rebuild sources without importing OL sources.
- `src/style.ts` — `buildStyle(state)` and `styleVariables(state)`: the WebGLTile style that stretches raw values and colours them.
- `src/colormaps.ts` — `COLORMAP_STOPS` (32 RGB stops each for gray, viridis, plasma, inferno, magma, cividis, generated from matplotlib; regenerate rather than hand-edit), `COLORMAPS`, `palette(name)` (expands to 256 colours).
- `src/layers.ts` — `createSource(meta, display)` (GeoTIFF source reading only the displayed bands) and `createLayer(meta, view, controller)`: one `WebGLTileLayer` per file, registered with the controller; returns `null` (layer skipped) when the file lies entirely outside the view projection's extent.
- `src/controls/Toolbar.ts` — top-right OL control: mode (Gray/RGB), band picker(s), min, max, scale, colormap, a "Grid" checkbox (when given `{ graticule }`; toggles the layer's visibility, not display state), plus an error line. Every edit submits the whole form to `controller.update`, and the form re-syncs from `controller.onChange`.
- `src/graticule.ts` — `createGraticule()` (OL `Graticule` layer, hidden until toggled, labels like `30°N`/`45°W` via `formatDegrees`, mid-gray dashed lines).
- `src/controls/LonLat.ts` — bottom-right `MousePosition` readout (`lonLatFormatter`, `formatLonLat`).
- `src/manachitra.css` — control styles (light/dark tokens), imported by `src/index.ts`.
- `test/` — Vitest unit tests, one file per area. `test/helpers/evaluate.ts` is a small CPU evaluator for the style-expression subset `style.ts` emits, so style tests assert the colour a pixel gets, not the expression's shape; extend it if `style.ts` starts using new operators. DOM tests opt in with `// @vitest-environment jsdom`. Network (`geotiff`) and WebGL are mocked or out of scope; `layers.ts`/`buildMap`'s map construction are covered by browser checks only.
- TypeScript conventions: named exports only (no default exports); types live in the module that owns them (`Body`/`BodyRef` in bodies, `ViewCrs`/`ProjectionRef` in projections, `Meta`/`SourceMeta` in metadata, `DisplayState`/`Scale` in display, `ColormapName` in colormaps) and public ones are re-exported from `index.ts`. Relative imports keep the `.js` extension (resolved to `.ts`); type-only imports use `import type`. Lookup tables use `satisfies` so their keys become types (`BodyName`, `ProjectionName`, `ColormapName`); string inputs are typed as `Name | (string & {})` to keep completion while staying case-insensitive. Runtime validation stays even where types forbid bad input, because JS callers and the toolbar form can pass anything; tests cast deliberately invalid inputs (`as unknown as ...`).
- TypeScript is pinned to 6.0.x because typescript-eslint 8 supports only `<6.1`; don't move to TS 7 until it does.

`buildMap` order: validate args (display without band numbers) → `proj4.defs` view → read headers (unusable files are dropped: no CRS in the GeoKeys, or coordinates that need unit conversion) → `proj4.defs` each source CRS → `registerAll` → fail with a clear error if no file could be read → `DisplayController` (band count = minimum over files) → layers → controls → `View.fit(view extent)`.

## Decisions (keep unless asked to change)

- View CRS uses the **body's reference ellipsoid** (`+a=<a> +b=<b>` from `BODIES`, e.g. Jupiter a = 71492000, b = 66854000 m) for every projection, never the mean-radius sphere. Verify `BODIES` against pyproj IAU_2015 before release.
    - Spherical bodies (a = b, e.g. Venus, Moon) just get a = b.
    - proj4js (2.23) differs per projection. `eqc` and `stere` are ellipsoidal: eqc y is the meridian arc length, so the pole sits below `πa/2`, and the stere equator radius is not `2a`. `moll` is spherical only: with `+a/+b` it scales by `a` and ignores `b`. `viewCrs` computes every view extent by projecting sample points from a geographic CRS on the same ellipsoid (eqc/moll: `[180, 0]`, `[0, 90]`; stere: `[0, 0]`). That geographic CRS is passed to proj4 as a string and never registered, so OL never sees a degree-based def. Jupiter extents match PROJ `cs2cs` except EQC y (see Known gotchas).
    - proj4js applies **no datum step** between CRSs without `+datum`/`+towgs84` (its `PJD_NODATUM`), which covers our view CRSs and the GeoKey-derived source CRSs. Lon/lat pass between ellipsoids unchanged: 45° on the aurora's a = 71892000 ellipsoid is 45° on the view ellipsoid; there is no geocentric conversion. Don't add `+datum`/`+towgs84` to view defs; the graticule relies on this too (below).
- Polar stereographic views cover one hemisphere (extent out to the projected equator); files in the other hemisphere are skipped.
- Only cylindrical projections (`eqc`) are `global` (horizontal wrap).
- Source files are LAEA with small extents and often different centres → one CRS code per distinct proj string.
- Never use the `EPSG:` prefix for planetary CRSs.
- Always pass `projection` to the `ol/source/GeoTIFF` source: OL's default detection only reads EPSG codes, and planetary files use user-defined (32767) GeoKeys.
- Call `register(proj4)` **once, after all `proj4.defs` calls** (it loops over all pairs; later defs are invisible to OL). Source defs get `+units=m` appended if missing (OL needs units).
- Display: one state (`bands`, `min`, `max`, `scale`, `colormap`, `nodata`) shared by every layer so tiles stretch identically (no seams). The `display` option and the toolbar both go through `DisplayController`.
    - Sources use `normalize: false`, so the style sees raw values, and read **only the displayed bands** (`bands` in `sources[]`, in display order): 1 = gray (colormap applies), 3 = RGB (same stretch per channel; colormap disabled). The style therefore always reads OUTPUT bands 1 or 1..3. Band pickers are limited to `1..min(bandCount)` over all files.
    - Don't go back to reading all bands: OL packs 4 bands per texture, and WebGL allows only 16–32 texture units, so a 150-band file failed with "FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS". Changing band numbers therefore rebuilds each layer's source (`setSource`, tiles refetched).
    - `min`/`max` are single numbers shared by all shown bands (no per-band arrays). `scale` is `linear` or `log`; log needs `min > 0`.
    - What each change costs: `min`/`max` are style variables (`updateStyleVariables`, no shader recompile). Scale, colormap or gray↔RGB rebuild each layer's style (`setStyle`). New band numbers rebuild the source (`setSource`).
    - OL expressions have no `log`: the log stretch is an `interpolate` over 33 geometrically spaced stops `s0..s32` (`min·(max/min)^(i/32)`), passed as variables and recomputed in JS.
    - The colormap is a `palette` lookup (256 colours, nearest sampling) indexed by `t·255`. Don't nest an `interpolate` colormap around the stretch: OL inlines the input expression once per stop, which explodes shader size for log.
    - Nodata is OL's job, not the style's: OL (10.11) adds `if (getBandValue(nodataBandIndex) == 0.0) discard;` to every WebGLTile shader. It uses the source's nodata mask band (file GDAL nodata or `display.nodata`) or, for reprojected sources without nodata, a coverage band it appends. Don't re-implement this in `style.ts`. `nodata` can't change after build (it's in the source).
- Lon/lat readout: planetographic latitude (geodetic on the body ellipsoid), east-positive longitude in [-180, 180], 2 decimals. Uses an unregistered `+proj=longlat` string on the same ellipsoid; shows `–` outside the view extent or where the projection doesn't round-trip (e.g. outside the Mollweide ellipse).
- Lon/lat grid: OL's `Graticule` (bespoke code is only the toggle, labels and `worldExtent`). It works in `EPSG:4326`, which is safe here only because of the no-datum behaviour above: EPSG:4326 lon/lat is used as the body's lon/lat as-is, and all distances come from the view projection on the body ellipsoid. Verified metrically (`test/graticule.test.ts`): grid-line gaps match PROJ `geod` on Jupiter within 25 ppm (1° of latitude at the equator = 1091.146 km; Earth would be 110.6 km). Graticule picks its spacing from view metres, never Earth radii. Views must set `worldExtent` (polar views: one hemisphere) or Graticule throws.
- Every layer gets `extent` (`footprintInView`: grid-sampled footprint, clipped to the view extent, padded 3%, with the pole added at all longitudes when a source contains it) and `maxResolution` (`resolution * 64`). The extent is required, not just an optimisation: without it a polar-stereo file renders blank in EQC.

## Known gotchas

- Degree-based (`longlat`) CRSs: OL's `metersPerUnit` for degrees is Earth-based; create the Projection manually with `metersPerUnit = 2πR/360` before `register(proj4)`.
- ScaleLine / `getPointResolution` / `ol/sphere` default to Earth radius. Measured: `getPointResolution` on `JUP:EQC` returns 95.5 m/px for a true 1000 m/px (≈ Earth/Jupiter radius ratio), because it measures via EPSG:4326 on an Earth sphere. Before adding a scale bar or measuring tool, set `setGetPointResolution` per view projection and pass `radius` to sphere functions. The graticule and lon/lat readout don't use these, so they're unaffected.
- Identical CRS under different codes → needless client-side reprojection (blur). Normalise proj strings before deduplicating.
- Hundreds of WebGL layers can exceed the browser's WebGL context limit ("Too many active WebGL contexts") → black/blank layers.
- EQC on an ellipsoid differs between proj4js and PROJ/pyproj: proj4js uses the meridian arc length (Jupiter pole y = 108687 km), while PROJ uses `a·lat` and ignores `b` (pole y = 112299 km). The view is self-consistent, because OL does both directions through proj4js. But view y-coordinates won't match pyproj's eqc, and an ellipsoidal EQC _source_ file written by GDAL would be misplaced in latitude by proj4js.
- Black/flat tiles are usually a stretch mismatch (e.g. GRS band 7 peaks at 0.094, so min 0.2 renders all black; `jupiter_aurora_all.tif` peaks at 4, so max 500 is near black) or unrecognised nodata. Debug with `layer.getData(pixel)` (raw values; the mask band reads 255) and the geotiff.js header dump logged by `readMeta`.
- Blank at low zoom but data exists: OL uses the coarsest overview first, and sparse files can have all-NaN overviews (`jupiter_aurora_all.tif` band 1). Check overviews with geotiff.js `getImage(imageCount - 1)` before suspecting the renderer.
- Pixel-interleaved files (`INTERLEAVE=PIXEL`) with many bands are slow to show one band: every tile holds all bands, so reading band 1 of the 150-band aurora downloads and inflates ~157 MB per 512² tile (2.5 s per full-res read in node). Prefer band-interleaved COGs (`-co INTERLEAVE=BAND` with GDAL ≥ 3.11's COG driver, or GTiff `-co INTERLEAVE=BAND -co TILED=YES -co COPY_SRC_OVERVIEWS=YES`).
- Headless Chrome screenshots (`--virtual-time-budget`) capture blank maps when the page has no pending timers: virtual time jumps to the end of the budget while tiles are still decoding off the main thread. Keep a timer pending in test pages (`setTimeout(() => {}, 8000)`) before judging a render, and still don't use headless runs for files with very large tiles.
- `pkill -f "vite --port N"` run from the same shell command that started Vite matches that shell's own command line and kills it. Stop the dev server in a separate command, e.g. `pkill -f "[n]ode.*vite --port N"`.

## Open work

1. East- vs west-positive longitude and 0–360 domains (`+lon_0=180`, view extent, planetographic CRSs), and a configurable central longitude / bounding latitude for view projections. Not yet handled.
2. Replace per-file header reads with a Python-generated `manifest.json` (rasterio: url, `crs.to_proj4()`/PROJJSON, bounds, res, global band stats).
3. Lazy layer creation/removal based on the current view (avoids the WebGL context limit and the startup header fan-out).
4. Radius-aware ScaleLine and measurement tools.
5. Toolbar extras: "auto" min/max from embedded band statistics, reversed colormaps, per-channel RGB stretch, and a value-under-cursor readout.
6. Validate one file end-to-end: `toProj4` output vs rasterio `src.crs.to_proj4()`.
