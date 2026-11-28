# Petrol tokens in Figma

The Petrol tokens can be exported as a design-tokens JSON and imported into Figma as variables. The CSS in
`src/ui/tokens/` stays the source of truth. The Figma copy is a snapshot: re-export and re-import when a token changes.

## The file

[`figma/petrol-tokens.json`](figma/petrol-tokens.json) is generated, never hand-edited. Format: W3C design tokens
(`$type` / `$value`), the format [Tokens Studio for Figma](https://tokens.studio/) reads.

| Set     | Holds                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`  | Neutral ramp, teal, gold, danger, success, warning, test and chart colours; spacing, radius, bevel, borders, tap target; fonts, sizes, weights, leading, tracking; motion durations and easing |
| `paper` | Semantic colours (canvas, surface, text, accent, danger and so on) for the light surface mode                                                                                                  |
| `stage` | The same semantic names for the dark surface mode                                                                                                                                              |

`paper` and `stage` alias into `core` (for example `accent` is `{color.teal.700}` on paper and `{color.teal.300}` on
stage), so a Figma colour variable has one name and two modes. The file also carries two themes, Paper and Stage.
Sizes are in px (the CSS uses rem at 16px).

Not exported: the `roles.css` layer, component styles, density and brand colours. Those are decisions about how the
parts use the tokens, not tokens.

## Regenerate

```powershell
npm run tokens:figma
```

A test (`tools/export-figma-tokens.test.js`) fails when the committed file no longer matches the CSS, so a token change
cannot land without a fresh export.

## Import into Figma

1. In Figma, install the Tokens Studio for Figma plugin.
2. Open it, choose to load tokens from a file or paste JSON, and use `petrol-tokens.json`.
3. Check that the sets `core`, `paper` and `stage` and the themes Paper and Stage appeared.
4. Use the plugin's "Create variables" (or "Export to Figma") to make Figma variables. Map the Paper and Stage themes
   to two modes of one collection.

Not yet tried in Figma: the file has been checked against the CSS and the format, not imported into a live Figma
file. Tokens Studio may limit the number of themes on its free plan. If so, import `core` plus one of `paper` or `stage`
per file.

## Fonts

Chakra Petch (display) and Hanken Grotesk (body) are self-hosted in `src/ui/tokens/fonts/`. Install them locally for
Figma to render text correctly; both are open-licence Google Fonts families. Figma does not load the repo's font files.
