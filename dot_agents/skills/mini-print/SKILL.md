---
name: mini-print
description: Use when downloading PrintableHeroes paper minis and assembling print-ready PDFs with black backing halos, true-size scaling, and fewest-pages packing.
---

## [OBJECTIVE]

Download paper-mini PNGs (from printableheroes.com API or user-supplied files), apply the black silhouette backing (halo + base) when missing, and pack them onto A4 pages at true physical size using the fewest pages possible. Verify size and overlaps before delivery.

## [TRIGGER_CONDITIONS]

Use this skill when the user:
- Asks to download minis from PrintableHeroes
- Points to downloaded mini PNGs and wants a printable PDF
- Wants minis rearranged, resized, recolored, or repacked across pages
- Asks about mini print size, base size, or page count

## [INPUTS]

- `minis` (required): list of mini names (`Dragonborn_Barbarian` style) OR paths to local PNG files
- `token` (API only): PrintableHeroes bearer JWT, supplied by the user at runtime

## [EXECUTION_SEQUENCE]

### [STEP_1_AUTH]

- Store the token with `write` to `/tmp/ph_token`, `chmod 600`. Never `echo` it or let it appear in logs.
- Every API call sends header `Authorization: Bearer $TOK`.
- Base URL: `https://api.printableheroes.com`. Frontend JS (Next.js chunks) documents the contract if endpoints change.

### [STEP_2_API_REFERENCE]

| Purpose | Endpoint |
|---|---|
| Catalog | `GET /api/minis/getall` |
| Mini detail + variant list | `GET /api/minis/get?id=X&languageKey=en&onlyDirectTags=false` |
| Print art (fold-over strip) | `GET /api/minivariantfiles/png?miniId=X&miniVariantId=Y` |
| Black backing (halo + base) | `GET /api/minivariantfiles/silhouette?miniId=X&miniVariantId=Y&shouldDefaultToFoundation=true` |
| Preview thumb | `GET /api/minivariantfiles/thumbnail?miniId=X&miniVariantId=Y` |
| Variant detail | `GET /api/minivariant/get?miniVariantId=Y` |

- Variants within one mini are color schemes of one pose (plus one B&W line-art variant). Different mini Ids under one name are different poses — never guess; thumbnail them.
- Skip minis whose detail returns an empty `MiniVariants` list (dead entries).

### [STEP_3_SELECTION]

1. Match names with underscores converted to spaces, case-insensitive, against `getall`.
2. Single match: use lowest mini Id, lowest variant Id (the base/original release).
3. Multiple matches: download one thumbnail per candidate (highest-UserLevel variant first), tile into a labeled contact sheet, and let the user pick. Default if they decline: lowest mini Id.
4. Download choices as full PNG + matching-variant silhouette (same `miniVariantId` for both).

### [STEP_4_BACKING]

- The `/png` art carries only a thin outline — no halo, no base. The black halo + base comes from `/silhouette` (same role as the legacy `Layer 10 copy.png` / `Border.png` files in old PNG-zip packs).
- Composite with PIL: `Image.alpha_composite(backing.convert('RGBA'), art.convert('RGBA'))`. If sizes differ, resize the backing to the art.
- Verify visually on white: halo must hug the figure, base ellipse solid black at the bottom of each half.

### [STEP_5_SIZING]

- All site PNGs are 300 DPI with the DPI tag set. True size = `px * 72 / 300` pt. Place at exactly that rect. Never downscale or normalize heights — relative scale (halfling small, dragonborn big) is encoded in the pixels.
- Default: PNG size as-is. Shrink one mini only on explicit user request.
- Base-normalize procedure (only when asked, e.g. an oversized Duergar): measure each mini's base as the widest fully-black opaque span in the bottom 18% of rows; scale the outlier to the median base width of the set.

### [STEP_6_PACKING]

- Page: A4, `595 x 842` pt. Margins `32`, gap `10` (tuned: smallest that still holds the most minis per page; stays inside typical printer unprintable zones).
- Shelf pack, tallest first with first-fit into existing rows: sort minis tallest first; place each into the first open row (any page) whose remaining width fits it and whose height accommodates it; else open a new row on the last page (or a new page). Row height = tallest mini in the row. First-fit backfills gaps that plain next-fit shelves strand on a near-empty last page.
- Goal: fewest pages at true size. If it does not fit, say exactly what the math forbids (total row width vs. page capacity) instead of silently shrinking.
- Print instruction: 100% / "Actual size" — any fit-to-page scaling destroys true size.

### [STEP_7_VERIFY]

Every build must pass all three before delivery:
1. Rect check: collect `page.get_image_rects()` per page, assert pairwise intersections are empty (note: redacted-away images linger in `get_images()` — confirm ghosts against the rendered thumbnail).
2. Thumbnail check: render each page at 60–72 DPI and view it — no clipping, every mini has halo + base, no redaction scars.
3. Size check: print one placed rect's `width x height` in pt; spot-check base widths measure ~1 in for medium creatures.

## [OUTPUT_CONTRACT]

- Full-res art PNGs: one folder (e.g. `PrintableHeroes_PNGs/`), named `{Name}__{miniId}_{variantId}.png`.
- Print PDF: tiled A4, true size, black-backed, verified per STEP_7.
- Report: page count, what was excluded/substituted and why, print-at-100% reminder.

## [QUALITY_CONSTRAINTS]

- Never invent a zip/download endpoint — only the table in STEP_2 exists. Old layered PNG-zips are not served by this API.
- Never place a mini without its backing unless the source art already includes it.
- Never reuse stale anchors, cached thumbnails, or `/tmp` composites across runs without re-verifying dimensions match.
- One observable behavior per change: adding minis, swapping colors, and repacking are separate rebuilds.

## [EDGE_CASE_HANDLING]

| Condition | Action |
|---|---|
| Duplicate names, user picks "oldest" | Lowest mini Id; within it, lowest variant Id |
| User owns some minis already | Exclude by name; keep their files untouched |
| Rotated placement requested | Rotate the composited PNG (e.g. PIL `ROTATE_90`); true size swaps to `h x w` |
| Editing a flattened third-party PDF | Add new pages or white-fill redactions only; never trust `get_images()` counts after redaction |
| Footer/permission text in the way | It is text — redact and re-set smaller, or carry it to the new page |
