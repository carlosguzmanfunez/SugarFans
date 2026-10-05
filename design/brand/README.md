# Fans Reserve Identity V1

The official Fans Reserve identity, version 1. It is the approved direction and can keep
evolving in later versions. Everything visual derives from these sources and from the
tokens in `src/index.css` (`@theme`) and `src/config/theme.ts`.

| Source | Produces | How |
| --- | --- | --- |
| `kit/` | the approved logo kit (2026-10-05): logo for light and dark backgrounds (`-reverse`), icon, PNGs and presentation sheet | used as is |
| `mark.svg` | copy of `kit/fansreserve-icon-aprobado.svg`; `public/icons/icon-{192,512}.png` | `node scripts/brand-assets.mjs` |
| `mark-full.svg`, `mark-maskable.svg` | square-cornered icon for iOS (`icon-180.png`) and Android (`icon-maskable-512.png`, letters inside the safe zone) | same script |
| `favicon.svg` | `public/favicon.svg` (copy), `public/favicon-32.png` | same script |
| `coin.svg` | `public/brand/coin.png` (the Créditos symbol, shown by `CoinIcon`) | same script |
| `og.html` | `public/og-fans-reserve.jpg` (1200×630, Open Graph / X) | same script |
| `icon.html` | wrapper used to rasterise the marks (`?maskable`, `?touch`, `?favicon`, `?coin`) | — |

The React version of the mark and wordmark is `src/components/BrandLogo.tsx` (same
geometry and the kit's wordmark outlines). If the mark changes, update
both and re-run the script.

## Mark (approved kit, 2026-10-05)

- Rounded tile (128 grid, radius 30) with a gradient `#CE4F9C` → `#8B3B9D` → `#392269`,
  a white "F" and a gold (`#FFD39A` → `#F3A54F`) bowl and leg that complete the "R":
  *Fans* inside *Reserve*.
- The same icon is used at every size, including the favicon.

## Wordmark

`FANS` bold + `RESERVE` regular, uppercase, drawn as outlines (no font needed). Ink
`#241C2F` on light backgrounds, white on dark ones (`tone="dark"`). Cap height ≈ 0.37×
the mark; gap between mark and wordmark ≈ a third of the mark.

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
