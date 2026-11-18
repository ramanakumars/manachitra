# manachitra

A browser viewer for planetary raster data: Cloud-Optimized GeoTIFFs (COGs) of Mars, Jupiter, the Moon and other bodies, shown in one map projection of your choice. It is written in TypeScript on [OpenLayers](https://openlayers.org/) and [proj4js](https://github.com/proj4js/proj4js), and aims for a pyproj + matplotlib-like workflow in the browser: each file's CRS is read from its GeoTIFF keys, the body is worked out from that CRS, and everything is reprojected into a single view.

There is no backend. COGs are read directly from any static host that supports CORS and HTTP Range requests.

## Features

- **Body from the files.** The planet or moon is identified from each file's CRS (ellipsoid name, else radius). Bodies not in the built-in table get a body made from the file's own ellipsoid.
- **View projections:** equirectangular, Mollweide, and north/south polar stereographic, all on the body's reference ellipsoid (IAU 2015 radii).
- **Layers panel:** add COGs by URL, show or hide each file, remove it, and collapse the panel. Files outside the current projection stay listed as "not in view".
- **Display toolbar:** gray (one band, with a colormap) or RGB (three bands), linear or log stretch, and viridis/plasma/inferno/magma/cividis/gray colormaps. The stretch is shared by all files, so mosaics have no seams.
- **Auto range** (on by default): min/max follow the 2nd–98th percentile of the visible data, sampled from each file's smallest overview. Uncheck it to type your own min/max.
- **Lon/lat grid and cursor readout,** using the body's own radius (not Earth's).

## Requirements

- Node.js 22.12+ or 24+ (required by the test tooling, Vitest 5; Vite alone needs 20.19+).
- A modern browser with WebGL.
- Your own data. COGs are not included in this repository (`*.tif` is gitignored).

## Installation

```sh
git clone git@github.com:ramanakumars/manachitra.git
cd manachitra
npm install
```

## Usage

### Run the viewer

```sh
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). The map starts empty, with the layers panel's URL box open:

1. Paste one or more COG URLs, one per line, and press **Add** (or Ctrl/Cmd+Enter). Files in `public/` are entered as `public/<name>.tif`.
2. The first file sets the body (shown in the top bar). Files from a different body are refused until every layer is removed.
3. Choose a projection in the top bar, adjust the stretch in the toolbar, and toggle or remove files in the layers panel.

### Embed it in a page

`index.html` is the whole demo:

```html
<div id="map" style="position: absolute; inset: 0"></div>
<script type="module">
    import { buildMap } from "./src/index.ts";

    buildMap("map");
</script>
```

Every option is optional:

```ts
import { buildMap } from "./src/index.ts";

const map = await buildMap("map", {
    projection: "npstere", // "eqc" (default) | "moll" | "npstere" | "spstere"
    sources: ["https://example.org/data/aurora.tif"], // COGs to load at start
    display: {
        bands: [1], // [n] = gray, [r, g, b] = RGB (1-based band numbers)
        scale: "log", // "linear" | "log"
        colormap: "magma",
        // min: 0, max: 500, // giving min/max turns the auto range off
    },
});

// The same controls the UI uses:
await map.get("sources").add(["https://example.org/data/b.tif"]);
map.get("viewController").update({ projection: "moll" });
map.get("display").update({ min: 0, max: 1 }); // fixed range
map.get("display").update({ auto: true }); // back to the data's range
```

`buildMap` resolves to an OpenLayers `Map`. The main objects are available as map properties: `"sources"` (the files), `"viewController"` (body and projection), `"display"` (the stretch) and `"autoRange"`.

The package is not published to npm yet; import from `src/index.ts`, which Vite transpiles directly.

## Preparing data

Files should be **COGs**: tiled, with overviews. Plain GeoTIFFs work, but a large one without overviews is downloaded in full even when zoomed out, which can stall the browser. Convert with GDAL:

```sh
gdal_translate -of COG -co COMPRESS=DEFLATE -co PREDICTOR=2 \
    -co BLOCKSIZE=512 -co OVERVIEW_RESAMPLING=AVERAGE in.tif out.tif
```

- Add `-a_nodata <value>` if the file has a fill value but no declared nodata.
- For files with many bands, also add `-co INTERLEAVE=BAND` (GDAL 3.11+). Otherwise showing one band reads all of them.
- The file's CRS must be in its GeoKeys, as a projected CRS in metres. User-defined planetary CRSs, as written by GDAL, are supported; geographic (degree) CRSs are untested.
- The host must support HTTP Range requests, and send CORS headers if it is on another origin. Vite's dev server handles Range requests for files in `public/`.

## Development

| Command              | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `npm run dev`        | Dev server for `index.html`                    |
| `npm run build`      | Production build into `dist/`                  |
| `npm test`           | Unit tests (Vitest)                            |
| `npm run test:watch` | Tests in watch mode                            |
| `npm run coverage`   | Tests with a v8 coverage report in `coverage/` |
| `npm run typecheck`  | `tsc` (strict; type checking only)             |
| `npm run lint`       | ESLint                                         |
| `npm run format`     | Prettier (4-space indent)                      |
| `npm run check`      | Lint, typecheck, format check and tests        |

Run `npm run check` before committing. [`CLAUDE.md`](CLAUDE.md) documents the architecture, design decisions and known gotchas in detail.

### Project layout

```
index.html          demo page: buildMap("map")
src/
  index.ts          buildMap and the public API
  options.ts        buildMap options and defaults
  bodies.ts         body table (IAU 2015 radii) and body detection
  projections.ts    view projections and their extents
  crs.ts            proj4 / OpenLayers CRS registration, file footprints
  metadata.ts       GeoTIFF header reads (CRS, bounds, bands, nodata)
  sources.ts        the files on the map and their layers
  layers.ts         one WebGL tile layer per file
  view.ts           body + projection state
  display.ts        shared display state (bands, stretch, colormap)
  autorange.ts      auto min/max from the data
  stats.ts          pixel sampling and percentiles
  style.ts          WebGL style for the stretch and colormap
  colormaps.ts      colormap tables
  graticule.ts      lon/lat grid
  controls/         view bar, toolbar, layers panel, lon/lat readout
  manachitra.css    control styles (light and dark)
test/               unit tests, one file per module
```

## Limitations

- Longitudes are east-positive in −180…180. West-positive and 0–360 conventions are not handled yet.
- Scale bars and distance measurement are not available (OpenLayers' defaults assume Earth's radius).
- Each file is its own WebGL layer, so very many files can exceed the browser's WebGL context limit.

See the "Known gotchas" and "Open work" sections of [`CLAUDE.md`](CLAUDE.md) for more.

## License

GNU General Public License v3.0. See [`LICENSE`](LICENSE).
