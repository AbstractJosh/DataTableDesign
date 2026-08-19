# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A **design handoff bundle**, not an application. There is no package.json, build system, test suite, or git repo — the entire contents are `design_handoff_data_table/`, which specifies a single-screen data-table UI (search, status filter, column sort, row selection + bulk bar, expandable detail rows, drag-to-reorder rows *and* columns, pagination).

The intended job is to **re-implement this design in a target codebase** (React, Vue, SwiftUI, native, …) using that codebase's own primitives. The HTML here is a reference prototype and must not be ported literally.

`design_handoff_data_table/README.md` is the authoritative spec — exact colors, px values, typography, interaction semantics, state shape and derive order. Read it in full before implementing anything; do not re-derive those values by reading the prototype's inline styles.

## Running the prototype

No build step. Open `design_handoff_data_table/Data Table.dc.html` in a browser (file:// works). `support.js` pulls React 18, ReactDOM and `@babel/standalone` from unpkg at runtime, so an internet connection is required; Archivo also loads from Google Fonts.

## The `.dc.html` format

`Data Table.dc.html` is a streaming-template file for an internal "dc" runtime, **not** JSX and not a framework file:

- `<x-dc>` wraps the markup; `<helmet>` holds `<link>`/`<style>` hoisted into `<head>`.
- `{{ name }}` holes, `<sc-for list="{{ xs }}" as="x">` loops, `<sc-if value="{{ b }}">` conditionals.
- `<script type="text/x-dc" data-dc-script data-props="…">` holds one `class Component extends DCLogic` with React-style `this.state` / `this.setState`.
- `renderVals()` returns the object that fills every hole — including per-element inline `style` objects and `onClick`/`onDrag*` handlers. All styling lives here as inline style objects; the file uses **zero** CSS classes.
- `data-props` is a JSON blob declaring the tweakable props surfaced in the design tool: `accentColor` (default `#1d2d46`), `density`, `rowsPerPage`, `zebraRows`. These map to component props in a port.
- Non-render mutable refs (`this.dragRow`, `this.dragCol`) are deliberately kept off `state` so dragging does not re-render per event.

`support.js` is generated (`dc-runtime`) — never edit it, and there is nothing in it to port.

## Design system

`design_handoff_data_table/_ds/modernist-<uuid>/` holds the **Modernist** system: `styles.css` (the `:root` token sheet with 100–900 OKLCH ramps plus a component layer) and `readme.md` (the rules). Note this is a *trimmed* copy — `readme.md` describes `components/`, `foundations/`, `templates/` and `theme.json` that are not present in the bundle, and `_ds_bundle.js` is an empty stub.

Two system rules override anything a port might default to: **radius is 0 everywhere**, and structural borders are **2px** (1px `#d7d3d3` only for row dividers). Flat only — bevels, gradients and drop shadows on the table header were explicitly tried and rejected.

Critical override: the bound system's accent is red `#ec3013`, but this screen's accent is **navy `#1d2d46`**. Red is reserved for destructive/negative only (Failed pill, delete button, link hover). Green `#2f7d4f` is a project addition for Success.

## Implementation gotchas called out by the spec

- Derive order per render is fixed: filter (status, then query) → sort → paginate → slice.
- Sorting is `String(a[key]).localeCompare(...)` on the filtered set — lexicographic even for dates. Swap in real comparators when wiring real data.
- Selection and expansion are keyed by record id and survive paging/filtering; the header checkbox toggles only the current page.
- Prefer a real drag-and-drop library over the prototype's raw HTML5 handlers, and add keyboard-accessible reordering — the prototype has none.
- Icons are inline SVGs traced from Lucide (`pencil`, `trash-2`, `chevron-down`, `check`, `plus`); use the target codebase's Lucide package instead. The row/column grip is the Braille glyph `⠿` (U+283F), not an icon.
- `uploads/Alp_Havacılık-1538940458.png` (ALP logo, non-ASCII filename) is rendered at 32px height in the table header's first cell; route it through the target's asset pipeline.
