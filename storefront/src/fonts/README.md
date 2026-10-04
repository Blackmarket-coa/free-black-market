# Self-hosted fonts

`exo2-latin-wght.woff2` and `urbanist-latin-wght.woff2` are the latin-subset
variable (wght 100–900) builds of **Exo 2** (v26) and **Urbanist** (v18) as
served by Google Fonts on 2026-10-04, downloaded from `fonts.gstatic.com` and
committed here so the storefront build never fetches fonts at build time.

Why: `next/font/google` downloads the CSS and the font files during
`next build`. Google's response for Next's hard-coded user agent intermittently
came back in a shape the loader cannot parse (`loader.js` reads a file
extension off each URL and gets `null`), which failed the storefront Docker
build on two of four CI runs on 2026-10-03/04 with no code change between a
red and a green run. `next/font/local` removes the network dependency; the
rendered fonts, weights and CSS variables are unchanged.

Both families are licensed under the SIL Open Font License 1.1, which permits
bundling and redistribution: https://openfontlicense.org/ — Exo 2 © Natanael
Gama; Urbanist © Corey Hu. The licence requires that the fonts are not sold by
themselves; they are not.

To refresh: request `https://fonts.googleapis.com/css2?family=<Family>:wght@100..900`
with a modern browser user agent, take the `/* latin */` block's `src: url(...)`
and replace the file; keep the variable (wght range) build so the four heading
weights and four body weights `layout.tsx` declares keep working.
