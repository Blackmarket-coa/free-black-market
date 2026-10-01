# Image Asset Inventory

Inventory of every image file committed to this repository, produced to close the
"trademarked brand SVGs and stock photos appear committed" finding in
`PRE_LAUNCH_AUDIT.md` (LEG-8). It records what each file is, where it is used, and a
recommended action. It does **not** remove anything: which marks and photographs to drop is
a product and legal decision, and the decisions a human must make are listed at the end.

- **Date:** 2026-09-22
- **Branch:** `claude/coalitions-network-feature-d82y5q`
- **Method:** `git ls-files` filtered to `svg png jpg jpeg webp gif ico avif` (node_modules,
  `.next`, `dist`, `build` and `mobile/www` excluded; an unfiltered `find` over the working
  tree returned the same 117 files). Size from `stat`, dimensions and format from `file`,
  duplicates by `md5sum`, metadata by `strings` (no `exiftool`, `identify` or Python PIL on
  the machine). SVGs were read as text; rasters were viewed directly. References were found by
  grepping each basename and path across the repo excluding node_modules, then checking
  whether the referencing component or data file is itself rendered or imported.
- **Attribution evidence:** no `LICENSE`, `CREDITS`, `ATTRIBUTION` or `README` exists in any
  `public/`, `images/` or `assets/` directory, and no document in the repo credits a
  photographer, stock library or brand. `NOTICE` covers software only. The only embedded
  license text in any image is the Font Awesome comment inside
  `storefront/public/images/placeholder.svg`. The `Copyright (c) 1998 Hewlett-Packard`
  string found in every JPEG is the embedded sRGB ICC profile, not a photo credit. No JPEG
  carries EXIF author, artist or copyright fields.

## Classification key

| Class | Meaning |
| --- | --- |
| `THIRD_PARTY_MARK` | Contains a third party's logo, wordmark, product UI or brand-identifying design |
| `PHOTO_UNKNOWN_PROVENANCE` | Photograph or product cut-out with no license or attribution evidence |
| `OWN` | This project's own logo, icon, illustration or generated art (or a licensed generic icon, noted) |
| `+ UNUSED` | Appended when no code, config or document references the file at all |

Where a file is both a photograph and carries a mark, the content column says so and the
class is the one that drives the recommended action. "Dead ref" in the references column
means the only reference is from code that is never rendered or a data file that is never
imported.

## Summary

| Class | Files | Bytes |
| --- | --- | --- |
| `THIRD_PARTY_MARK` | 8 | ~1.1 MB |
| `PHOTO_UNKNOWN_PROVENANCE` | 27 | ~32.6 MB |
| `OWN` (web apps and portals) | 19 | ~2.3 MB |
| `OWN` (mobile icon/splash sets, one row below) | 63 | ~2.4 MB |
| **Total** | **117** | **~38.4 MB** |
| of which `UNUSED` (no reference anywhere) | 23 | ~23.4 MB |
| of which dead-referenced only | 8 | ~40 KB |

## Inventory

Paths are repo-relative. Dimensions are `width x height` in pixels for rasters and the SVG
`viewBox`/intrinsic size for vectors.

### Third-party marks

| Path | Size | Dimensions | Depicts | References | Class | Nominative? / Guidelines | Recommended action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `storefront/public/images/brands/Balenciaga.svg` | 2.8 KB | 240x40 | BALENCIAGA wordmark, vector paths | `storefront/src/components/sections/HomePopularBrandsSection/HomePopularBrandsSection.tsx:9` (dead ref: the section is exported from `sections/index.ts` but rendered by no page) | `THIRD_PARTY_MARK` | **No.** Shown in a "POPULAR BRANDS" carousel with `href: '#'`, which implies the brand sells here. Not "pay with"/"sign in with"/"share to". I do not know of published usage guidelines for this mark. | **Remove** file and the four `brands` entries; delete or repurpose the section |
| `storefront/public/images/brands/Miu-Miu.svg` | 3.6 KB | 240x40 | MIU MIU wordmark, vector paths | same file, line 27 (dead ref) | `THIRD_PARTY_MARK` | No, as above. No known published guidelines. | **Remove** |
| `storefront/public/images/brands/Nike.svg` | 629 B | 240x40 | Nike swoosh, vector path | same file, line 15 (dead ref) | `THIRD_PARTY_MARK` | No, as above. Nike is known to publish trademark and brand-usage guidance and to enforce the swoosh actively. | **Remove** |
| `storefront/public/images/brands/Prada.svg` | 5.2 KB | 240x40 | PRADA wordmark, vector paths | same file, line 21 (dead ref) | `THIRD_PARTY_MARK` | No, as above. No known published guidelines. | **Remove** |
| `storefront/public/images/categories/sneakers.png` | 119 KB | 512x512 RGBA | Blue/red/white running shoe cut-out with the adidas trefoil and three-stripes clearly visible | none (`storefront/src/lib/helpers/seo.ts:69,83` builds `/images/categories/<handle>.png` at runtime, but no seeded or coded category has handle `sneakers`) | `THIRD_PARTY_MARK` `+ UNUSED` | No. Would appear as a category/OG image, not as a reference to the brand. adidas is known to publish brand guidelines and to enforce the three-stripes mark. | **Remove** |
| `storefront/public/images/categories/sport.png` | 499 KB | 1000x1000 RGBA | Lime running shoes cut-out with the Puma formstrip and leaping-cat logo | none (same runtime-path caveat, no `sport` handle) | `THIRD_PARTY_MARK` `+ UNUSED` | No. Puma is known to publish brand guidelines. | **Remove** |
| `storefront/public/images/categories/sandals.png` | 387 KB | 1105x676 RGBA | Brown leather sandal cut-out with "AOKANG" embossed on the strap (a footwear manufacturer's mark) | none (same caveat, no `sandals` handle) | `THIRD_PARTY_MARK` `+ UNUSED` | No. I have no knowledge of this brand's guidelines. | **Remove** |
| `storefront/public/algolia-import.png` | 43 KB | 518x431 RGBA | Screenshot of the Algolia search-dashboard UI ("Manage index" menu, "Import Configuration") | `storefront/src/app/[locale]/(main)/sell/SellPageClient.tsx:58`, shown on the vendor signup page captioned "Order management" | `THIRD_PARTY_MARK` (product UI screenshot) | No. It is presented as a screenshot of *this* platform's order-management view, which it is not. I believe Algolia publishes a brand/trademark page but am not certain of its terms. | **Replace with own artwork** (a real screenshot of the vendor panel) |

### Photographs and product cut-outs of unknown provenance

None of these files carries a credit, and no stock library, photographer or license is named
anywhere in the repo. The storefront descends from the Mercur B2C starter
(`storefront/README.md`), and these paths match that template's demo layout, so the most
likely origin is template demo assets; that is an inference, not evidence. Shallow clone
history (201 commits) does not reach the commits that added them.

| Path | Size | Dimensions | Depicts | References | Class | Metadata / notes | Recommended action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `storefront/public/3d.jpg` | 2.7 MB | 5152x7728 | Bambu Lab 3D printer mid-print, "Bambu Lab" logo prominent on the tool head and build plate | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | Also an incidental third-party mark. Byte-identical to `images/categories/3d.jpg`. | **Remove** |
| `storefront/public/accessories.jpg` | 1.1 MB | 5000x3333 | Flat-lay of black bead necklace, cocktail ring, octagonal watch, pink fabric flowers | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | Identical to `images/categories/accessories.jpg`. | **Remove** |
| `storefront/public/components.jpg` | 934 KB | 4866x3647 | Disassembled smartphone parts laid out on white (a memory chip's manufacturer marking is legible) | `SellPageClient.tsx:68`, captioned "Vendor messaging" | `PHOTO_UNKNOWN_PROVENANCE` | Identical to `images/categories/components.jpg`. The image has nothing to do with its caption. | **Replace with own artwork** (vendor-panel screenshot); until then **obtain license** or **confirm source** |
| `storefront/public/crafted.jpg` | 1.7 MB | 5152x7728 | Two hands wearing many gemstone rings in front of a gilt mirror | `SellPageClient.tsx:73`, captioned "Impact metrics" | `PHOTO_UNKNOWN_PROVENANCE` | Identical to `images/categories/crafted.jpg`. Same caption mismatch. | **Replace with own artwork**; until then **confirm source** |
| `storefront/public/oil.jpg` | 3.3 MB | 6240x4160 | Wooden mortar, dandelions, tincture bottles on yellow | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | Identical to `images/categories/oil.jpg`. | **Remove** |
| `storefront/public/soap.jpg` | 592 KB | 3825x5737 | Hand stacking four round soap bars on marble | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | Identical to `images/categories/soap.jpg`. | **Remove** |
| `storefront/public/images/categories/3d.jpg` | 2.7 MB | 5152x7728 | duplicate of `3d.jpg` | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/categories/accessories.jpg` | 1.1 MB | 5000x3333 | duplicate of `accessories.jpg` | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/categories/components.jpg` | 934 KB | 4866x3647 | duplicate of `components.jpg` | none (the sell page uses the root copy) | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/categories/crafted.jpg` | 1.7 MB | 5152x7728 | duplicate of `crafted.jpg` | none (the sell page uses the root copy) | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/categories/oil.jpg` | 3.3 MB | 6240x4160 | duplicate of `oil.jpg` | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/categories/soap.jpg` | 592 KB | 3825x5737 | duplicate of `soap.jpg` | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/categories/accessories.png` | 4.3 KB | 225x185 gray+alpha | White baseball cap cut-out, no mark visible | none (runtime `<handle>.png` path; no `accessories` category handle in seed data, though an operator could create one) | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/categories/boots.png` | 21 KB | 226x185 RGBA | Leopard-print kitten-heel ankle boot cut-out | none (same caveat) | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/categories/shirt.png` | 70 KB | 384x377 RGBA | Plain orange T-shirt cut-out | none (same caveat) | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |
| `storefront/public/images/banner-section/Image.jpg` | 2.7 MB | 4000x3000 | Aerial drone shot of a village among palm trees | `storefront/src/components/sections/BannerSection/BannerSection.tsx:30`, `alt="Marketplace"`; rendered on the home page (`page.tsx:388`) | `PHOTO_UNKNOWN_PROVENANCE` | Identical to `banner-section/image.jpg`. | **Confirm source** or **replace with own artwork** |
| `storefront/public/images/banner-section/image.jpg` | 2.7 MB | 4000x3000 | duplicate (lower-case filename) | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | Case-only duplicate; also a hazard on case-insensitive filesystems. | **Remove** |
| `storefront/public/images/blog/post-1.jpg` | 219 KB | 1920x1275 | Raspberry Pi board in a clear case; the Raspberry Pi logo and name are legible | `storefront/src/components/sections/BlogSection/BlogSection.tsx:10`; rendered on the home page (`page.tsx:395`) | `PHOTO_UNKNOWN_PROVENANCE` | Also an incidental third-party mark. | **Confirm source** or **replace with own artwork** |
| `storefront/public/images/blog/post-2.jpg` | 2.4 MB | 5374x3583 | Courier handing a parcel to a smiling woman at a brownstone door; two identifiable faces, a house number is legible | `BlogSection.tsx:18`; rendered on the home page | `PHOTO_UNKNOWN_PROVENANCE` | Identifiable people: a model release question as well as a license question. | **Confirm source** (including model release) or **replace with own artwork** |
| `storefront/public/images/blog/post-3.jpg` | 1.4 MB | 5210x3473 | Overhead shot of a produce market stall, two people from above | `BlogSection.tsx:26`; rendered on the home page | `PHOTO_UNKNOWN_PROVENANCE` | | **Confirm source** or **replace with own artwork** |
| `storefront/public/images/shop-by-styles/Image.jpg` | 2.1 MB | 3953x5930 | Overhead shot of a fruit and vegetable market with two shoppers | `storefront/src/components/sections/ShopByStyle/ShopByStyleSection.tsx:39`, `alt="Browse products by type"`; rendered on the home page (`page.tsx:389`) | `PHOTO_UNKNOWN_PROVENANCE` | | **Confirm source** or **replace with own artwork** |
| `storefront/public/images/product/review-image-1.jpg` | 5.9 KB | 56x56 | Thumbnail of a blue/white high-top sneaker (too small to identify the brand) | `storefront/src/data/singleProductMock.ts:77` only; that file is imported by nothing (dead ref) | `PHOTO_UNKNOWN_PROVENANCE` | | **Remove** together with the mock entry |
| `storefront/public/images/product/review-image-2.jpg` | 6.8 KB | 56x56 | Thumbnail of a blue sneaker | `singleProductMock.ts:85` only (dead ref) | `PHOTO_UNKNOWN_PROVENANCE` | | **Remove** with the mock entry |
| `storefront/public/images/product/review-image-3.jpg` | 7.2 KB | 56x56 | Thumbnail of a red sneaker on red | `singleProductMock.ts:93` only (dead ref) | `PHOTO_UNKNOWN_PROVENANCE` | | **Remove** with the mock entry |
| `storefront/public/images/product/seller-avatar.jpg` | 5.7 KB | 58x58 | Head-and-shoulders photo of a young man in a white T-shirt (identifiable) | `storefront/src/data/sellerMock.ts:4`, `singleProductMock.ts:60`, `productFeedMock.ts` (8 rows), `cartMock.ts:14,50`; none of these files is imported (dead ref) | `PHOTO_UNKNOWN_PROVENANCE` | Identifiable person in mock data. | **Remove** with the mock entries |
| `storefront/public/talkjs-placeholder.jpg` | 1.1 KB | 200x200 | Generic grey head-and-shoulders avatar silhouette (illustration, not a photo) | `SellPageClient.tsx:63`, captioned "Payout tracking" | `PHOTO_UNKNOWN_PROVENANCE` | Filename suggests it was copied from TalkJS sample assets. Showing a blank avatar as a "payout tracking" screenshot is a product bug regardless of provenance. | **Replace with own artwork** |
| `vendor-panel/public/talkjs-placeholder.jpg` | 1.1 KB | 200x200 | byte-identical copy of the above | none | `PHOTO_UNKNOWN_PROVENANCE` `+ UNUSED` | | **Remove** |

### Own artwork, icons and placeholders

| Path | Size | Dimensions | Depicts | References | Class | Notes | Recommended action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin-panel/public/Logo.svg` | 3.8 KB | 2000x2000 | "BMC" serif letters in a gold gradient on dark green, `aria-label="BMC logo"` | `admin-panel/index.html:5` (favicon), `admin-panel/src/components/common/logo-box/{logo-box,avatar-box}.tsx` | `OWN` | Byte-identical to `vendor-panel/public/Logo.svg` and the four portal `favicon.svg` files. | **Keep** |
| `vendor-panel/public/Logo.svg` | 3.8 KB | 2000x2000 | same BMC mark | `vendor-panel/index.html:5`, `logo-box.tsx`, `avatar-box.tsx`, `main-layout.tsx:76`, `user-menu.tsx:111,142,337`, `profile-general-section.tsx:45`, `store-general-section.tsx:36` (also used as the default seller avatar) | `OWN` | | **Keep** |
| `botanical-portal/public/favicon.svg` | 3.8 KB | 2000x2000 | same BMC mark | `botanical-portal/index.html:5` | `OWN` | | **Keep** |
| `creator-portal/public/favicon.svg` | 3.8 KB | 2000x2000 | same BMC mark | `creator-portal/index.html:5` | `OWN` | | **Keep** |
| `nursery-portal/public/favicon.svg` | 3.8 KB | 2000x2000 | same BMC mark | `nursery-portal/index.html:5` | `OWN` | | **Keep** |
| `wellness-portal/public/favicon.svg` | 3.8 KB | 2000x2000 | same BMC mark | `wellness-portal/index.html:5` | `OWN` | | **Keep** |
| `storefront/public/Logo.svg` | 464 KB | 600x458 | An SVG wrapper around one base64 PNG: graffiti-style pit bull head over "BLACK MARKET COALITION" lettering on a brick wall | `storefront/src/components/organisms/Header/Header.tsx:58`, `(checkout)/layout.tsx:26`, `(reset-password)/layout.tsx:16`, `(vendor)/layout.tsx:26`, `CartItems.tsx` (x2, as default seller photo) | `OWN` | The embedded PNG is byte-identical to `B2C_Storefront_Open_Graph.png`. Not a real vector; 464 KB on every page. No record of who drew the artwork. | **Keep**; **confirm source** of the artwork; consider a true vector |
| `storefront/public/B2C_Storefront_Open_Graph.png` | 348 KB | 600x458 RGBA | same pit bull artwork | `storefront/src/app/[locale]/(main)/page.tsx:72` (OG image), `:174` (JSON-LD `logo`) | `OWN` | Filename is the Mercur template's; the content is FBM's. No embedded metadata. | **Keep**; **confirm source** |
| `storefront/public/android-chrome-192x192.png` | 3.6 KB | 192x192 | "BMC" in mint on black with a green border | none: there is no web manifest in `storefront/public` or `storefront/src/app` | `OWN` `+ UNUSED` | | **Remove**, or add a `manifest` that uses it |
| `storefront/public/android-chrome-512x512.png` | 10 KB | 512x512 | same mark | none in code; commit `d2ff7aeb` records it as the source the mobile icon sets were generated from | `OWN` `+ UNUSED` | Keep if it is the canonical source for regenerating mobile icons, otherwise `mobile/assets/icon.png` (1024x1024) already serves that role. | **Keep** or **remove** (see decisions) |
| `storefront/public/apple-touch-icon.png` | 3.3 KB | 180x180 | same mark | `storefront/src/app/layout.tsx:56` | `OWN` | | **Keep** |
| `storefront/public/favicon-16x16.png` | 244 B | 16x16 | same mark | `layout.tsx:55` | `OWN` | | **Keep** |
| `storefront/public/favicon-32x32.png` | 566 B | 32x32 | same mark | `layout.tsx:54` | `OWN` | | **Keep** |
| `storefront/public/favicon-64x64.png` | 1.2 KB | 64x64 | same mark | none | `OWN` `+ UNUSED` | | **Remove** |
| `storefront/src/app/favicon.ico` | 389 B | 16x16 (PNG data) | same mark | Served by the Next.js app-router file convention; `storefront/src/middleware.ts:255` excludes it from the locale matcher | `OWN` | | **Keep** |
| `storefront/public/images/hero/Image.jpg` | 139 KB | 1342x896 | "BMC / BLACK.MARKET.COALITION" gold wordmark on dark green | `page.tsx:162` (preload), `:195` (`<Hero image=...>`, alt "Hero banner - ..."), `Hero.stories.tsx:17` | `OWN` | | **Keep** |
| `storefront/public/images/hero/Logo.png` | 1.3 MB | 1024x1024 | "BMC" gold serif letters on dark green | none | `OWN` `+ UNUSED` | Carries a C2PA manifest whose `digitalSourceType` is `trainedAlgorithmicMedia`, i.e. the file records itself as generated imagery; the claim generator name is readable with `strings`. | **Remove** (unused, 1.3 MB) |
| `storefront/public/images/placeholder.svg` | 598 B | 512x512 | Generic "image" glyph (mountains and sun) | 12 sites: `ProductFeedItem.tsx:82,199`, `ProductCard.tsx:108,233`, `ReturnSummaryTab.tsx:54`, `ReturnItemsTab.tsx:63`, `Item.tsx:37`, `OrderCard.tsx:28`, `SingleOrderReturn.tsx:145`, `CartDropdownItem.tsx:36`, `CartItemsProducts.tsx:47`, `SellerAvatar.tsx:22`; also the fallback in `seo.ts:70,84` | `OWN` (licensed third-party icon) | Font Awesome Free 6.7.2 `image` icon; the file keeps its `fontawesome.com/license/free` comment (CC BY 4.0 for icons). Attribution is satisfied by the comment as long as it is not stripped by a minifier. | **Keep**; do not strip the license comment |
| `storefront/public/images/product/placeholder.jpg` | 26 KB | 350x432 | Grey/white transparency checkerboard | none. `SingleOrderReturn.tsx:118` references `/avatar-placeholder.jpg`, which does not exist in the repo (broken fallback) | `OWN` `+ UNUSED` | | **Remove**; fix the broken `/avatar-placeholder.jpg` reference separately |

### Mobile icon and splash sets (63 files, one row)

| Path | Size | Dimensions | Depicts | References | Class | Notes | Recommended action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mobile/assets/{icon,splash,splash-dark}.png`; `mobile/android/app/src/main/res/{mipmap-*/ic_launcher*.png, drawable*/splash.png}` (52 files); `mobile/ios/App/App/Assets.xcassets/{AppIcon.appiconset/AppIcon-512@2x.png, Splash.imageset/*.png}` (10 files) | 2.4 MB total; sources 1024x1024 and 2732x2732 | "BMC" mint-on-black mark, alone or centred on black | Consumed by Capacitor/Android/Xcode by path convention (`Contents.json`, resource qualifiers); `mobile/README.md` and commit `d2ff7aeb` document generation from the BMC mark via `@capacitor/assets` | `OWN` | Derived from the same mark as the storefront favicons. | **Keep** |

## Safe to delete

Each file below has **no reference anywhere in the repo**: its basename and path were grepped
across every file outside node_modules, `.git`, `.next`, `dist`, `build` and `mobile/www`,
and the only hits were other assets or this document. Deleting them changes no rendered
page. Sizes are approximate.

Third-party marks (1.0 MB):

- `storefront/public/images/categories/sneakers.png`
- `storefront/public/images/categories/sport.png`
- `storefront/public/images/categories/sandals.png`

Photographs of unknown provenance (21.1 MB):

- `storefront/public/3d.jpg`
- `storefront/public/accessories.jpg`
- `storefront/public/oil.jpg`
- `storefront/public/soap.jpg`
- `storefront/public/images/categories/3d.jpg`
- `storefront/public/images/categories/accessories.jpg`
- `storefront/public/images/categories/components.jpg`
- `storefront/public/images/categories/crafted.jpg`
- `storefront/public/images/categories/oil.jpg`
- `storefront/public/images/categories/soap.jpg`
- `storefront/public/images/categories/accessories.png`
- `storefront/public/images/categories/boots.png`
- `storefront/public/images/categories/shirt.png`
- `storefront/public/images/banner-section/image.jpg` (lower-case duplicate)
- `vendor-panel/public/talkjs-placeholder.jpg`

Own or generic (1.3 MB):

- `storefront/public/images/hero/Logo.png`
- `storefront/public/favicon-64x64.png`
- `storefront/public/android-chrome-192x192.png`
- `storefront/public/android-chrome-512x512.png` (only if it is not wanted as the mobile-icon source; see decisions)
- `storefront/public/images/product/placeholder.jpg`

Caveat for the six `images/categories/*.png` files: `storefront/src/lib/helpers/seo.ts:69,83`
builds `/images/categories/<category.handle>.png` as the Open Graph image for every category
page, so an operator who creates a category with handle `sneakers`, `sport`, `sandals`,
`accessories`, `boots` or `shirt` would surface one. No seeded or coded category has any of
these handles today, and the `||` fallback to `placeholder.svg` on that line never fires (a
non-empty string is always truthy), so after deletion those category pages would emit a 404
OG URL rather than the placeholder. That `seo.ts` bug is worth fixing alongside the deletion.

**Not** in this list, because they are referenced (even if only by dead code), and deleting
them means editing code that other agents may own:

- `storefront/public/images/brands/*.svg` (4 files) with `HomePopularBrandsSection.tsx`
- `storefront/public/images/product/review-image-{1,2,3}.jpg` and `seller-avatar.jpg` with
  `storefront/src/data/{singleProductMock,sellerMock,productFeedMock,cartMock}.ts`

## Decisions a human must make

1. **Brand logos.** Delete `storefront/public/images/brands/*` and the
   `HomePopularBrandsSection` component, or keep the component with real coalition vendor
   logos supplied under written permission. Displaying Nike, Prada, Miu Miu and Balenciaga as
   "popular brands" on a marketplace that does not sell them is the highest-exposure item here,
   even though the section is currently unrendered.
2. **Vendor signup page (`/sell`).** The four "dashboard shots" are an Algolia UI screenshot, a
   blank avatar, a phone-teardown photo and a rings photo, captioned as order management,
   payout tracking, messaging and impact metrics. Decide whether to replace them with real
   vendor-panel screenshots now or hide the gallery until screenshots exist.
3. **Home-page photographs.** `banner-section/Image.jpg`, `shop-by-styles/Image.jpg` and the
   three `blog/post-*.jpg` files are live on the home page with no license record. Options:
   trace and document a license (the Mercur template's own asset terms would be the first
   place to look), replace with photographs the coalition owns or has commissioned, or replace
   with the project's own illustrations. `post-2.jpg` also shows two identifiable people, so a
   model release matters as much as the photo license.
4. **Pit bull artwork.** `storefront/public/Logo.svg` and `B2C_Storefront_Open_Graph.png` are
   the storefront's primary logo and its OG image, and nothing records who created the artwork
   or under what terms. Confirm authorship and ownership (or assignment to the coalition) and
   record it, ideally in `NOTICE`.
5. **Generated imagery policy.** `images/hero/Logo.png` self-identifies as generated media via
   its C2PA manifest. It is unused and can go, but decide whether generated brand imagery is
   acceptable at all, since the same tooling may have produced other brand files that carry no
   manifest.
6. **Mobile icon source of truth.** Decide whether `storefront/public/android-chrome-512x512.png`
   or `mobile/assets/icon.png` is the canonical source for regenerating the mobile icon sets,
   then delete the other or document both.
7. **Mock data.** The four `storefront/src/data/*Mock.ts` files are imported by nothing and are
   the only references to `seller-avatar.jpg` (an identifiable person) and the review
   thumbnails. Removing the mocks and their images is a code change; decide who owns it.
8. **Attribution record going forward.** There is no place in the repo where image licenses are
   recorded. Decide where they should live (a `CREDITS.md` next to `storefront/public/images`,
   or a section in `NOTICE`) so that the next audit does not start from zero.
