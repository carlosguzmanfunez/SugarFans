# Fans Reserve — brand sources

Interim identity until the final logo is produced. Everything visual derives from
these sources and from the tokens in `src/index.css` (`@theme`) and
`src/config/theme.ts`.

| Source | Produces | How |
| --- | --- | --- |
| `mark.svg` | `public/favicon.svg` (copy), `public/favicon-32.png`, `public/icons/icon-{180,192,512}.png`, `public/icons/icon-maskable-512.png` | `node scripts/brand-assets.mjs` |
| `og.html` | `public/og-fans-reserve.jpg` (1200×630, Open Graph / X) | `node scripts/brand-assets.mjs` |
| `icon.html` | wrapper used to rasterise the mark (`?maskable`, `?touch`) | — |

The React version of the mark and wordmark is `src/components/BrandLogo.tsx`
(same drawing). If the mark changes, update both and re-run the script.

## Identity

- **Mark**: an "R" whose first strokes draw an "F" (white); the bowl and leg
  (gold) complete the R — *Fans* inside *Reserve*. Dark tile with a magenta glow.
- **Wordmark**: `FANS` Sora Bold + `RESERVE` Sora Light, uppercase, tracking 0.14em.
- **Type**: Sora (display/headings), Inter (body). Both self-hosted via
  `@fontsource-variable`.
- **Colour**: canvas `#faf7f5`, ink `#160d1f`, primary magenta `#c81b63`,
  secondary iris `#6d3ce6`, accent champagne gold `#e3a93a`. Signature gradient
  `bg-reserve` used only on key CTAs and the creator call to action.

## Pending final production (designer)

1. Final logo/mark in vector (replace `mark.svg` + `BrandLogo.tsx`).
2. Wordmark with custom kerning (today it is live text in Sora).
3. Real photography for the hero (today a composition of product UI) and for
   demo creators (today CC0 illustrated avatars in `public/creators/` and
   generated cover art).
4. Final virtual-currency coin artwork (`public/brand/coin.png`, today Fluent
   Emoji "coin").
