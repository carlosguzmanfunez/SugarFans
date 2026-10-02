# Fans Reserve Identity V1

The official Fans Reserve identity, version 1. It is the approved direction and can keep
evolving in later versions. Everything visual derives from these sources and from the
tokens in `src/index.css` (`@theme`) and `src/config/theme.ts`.

| Source | Produces | How |
| --- | --- | --- |
| `mark.svg` | `public/icons/icon-{180,192,512}.png`, `public/icons/icon-maskable-512.png`, OG logo | `node scripts/brand-assets.mjs` |
| `favicon.svg` | `public/favicon.svg` (copy), `public/favicon-32.png` | same script |
| `mark-mono-dark.svg`, `mark-mono-light.svg` | monochrome marks (one colour, strokes knocked out) | used as is |
| `lockup.html` | `exports/logo-{primary,mono-dark,mono-light}.png` (mark + wordmark) | same script |
| `coin.svg` | `public/brand/coin.png` (the Créditos symbol, shown by `CoinIcon`) | same script |
| `og.html` | `public/og-fans-reserve.jpg` (1200×630, Open Graph / X) | same script |
| `icon.html` | wrapper used to rasterise the marks (`?maskable`, `?touch`, `?favicon`, `?coin`) | — |

The React version of the mark and wordmark is `src/components/BrandLogo.tsx` (same
geometry, `variant="color" | "mono-dark" | "mono-light"`). If the mark changes, update
both and re-run the script.

## Mark

- An "R" whose first strokes draw an "F" (white); the bowl and leg (champagne gold)
  complete the R: *Fans* inside *Reserve*. Dark tile with a magenta glow.
- Geometry on a 40×40 grid, optically centred: stem x=12, top arm to x=23, bowl radius
  4.625 closing at y=19.75 (just above centre, as in the R of Sora), middle arm to x=20
  where the leg starts, leg to (28, 29.5). The leg reaches slightly past the bowl so the
  R doesn't lean back.
- Stroke 3.6 units; 4.2 below 28 px (`favicon.svg`, `BrandMark` at small sizes) so the
  F/R reads at 16–24 px. The hairline tile border is dropped at small sizes.

## Variants

- **Primary**: colour mark + ink wordmark (light backgrounds) or white/gold wordmark
  (`tone="dark"`, dark backgrounds).
- **Monochrome dark**: everything in ink `#160d1f`, for light backgrounds, print, stamps.
- **Monochrome light / inverse**: everything in white, for dark or photographic backgrounds.

## Wordmark

`FANS` Sora Bold (tracking 0.11em) + `RESERVE` Sora 350 (tracking 0.16em; the light
weight needs more air), uppercase. Trailing tracking is cancelled so the lockup centres
optically. Gap between mark and wordmark ≈ 0.6× the cap height (`gap-2` … `gap-3.5`
by size).

## Currency symbol (Créditos)

Champagne-gold coin with the FR mark engraved (dark gold with a light bevel), inner ring
and a highlight. No $, no crypto symbol. Legible from 12 px. The internal id stays
`terrones` (`src/config/currency.ts`); users only ever see "Créditos".

## Colour and type

- Canvas `#faf7f5`, ink `#160d1f`, primary magenta `#c81b63`, secondary iris `#6d3ce6`,
  accent champagne gold `#e3a93a`. Signature gradient `bg-reserve` only on key CTAs and
  the creator call to action.
- Sora (display/headings), Inter (body). Both self-hosted via `@fontsource-variable`.

## Pending production

1. **Photography of demo creators**: the main asset still pending. Today they use CC0
   illustrated avatars (`public/creators/`) and generated cover art. Real photos go in
   as local files (`avatar`, `cover` on each profile); the layout doesn't change. No
   stock photography or external URLs.
2. The hero stays a composition of Fans Reserve's own UI (approved), not photography.
3. The 25 gift artworks are Fluent Emoji 3D (MIT) for now; a custom set can replace
   them file by file in `public/gifts/` (names in `src/config/gifts.ts`).
