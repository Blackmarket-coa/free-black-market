# FBM Site Template

A ready-to-deploy storefront for a single Free Black Market vendor. It is the
**Connect** integration (Mode 1) pre-assembled into a standalone site so vendors
who don't have a website can get one in a click.

When a vendor hits **Launch** in their FBM vendor panel, the FBM backend:

1. Creates a new repository from this template (this repo must be marked as a
   **Template repository** in its GitHub settings).
2. Dispatches the [`configure`](.github/workflows/configure.yml) workflow with
   the vendor's handle.
3. The workflow replaces the `__VENDOR_HANDLE__` placeholders, writes a `CNAME`,
   commits, and publishes to **GitHub Pages**.

## Files

| File                              | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `index.html`                      | The storefront. Uses `connect.js` + `data-fbm="…"`.  |
| `styles.css`                      | Page chrome (header/sections/footer). Yours to edit. |
| `.github/workflows/configure.yml` | One-shot provisioning: bake handle → commit → deploy.|
| `.github/workflows/deploy.yml`    | Re-deploy on every push to `main`.                   |

## How it works

The whole storefront is driven by one script tag and a few HTML attributes:

```html
<div data-fbm="vendor"></div>
<div data-fbm="products" data-fbm-limit="12"></div>
<div data-fbm="events"></div>

<script
  src="https://freeblackmarket.com/connect.js"
  data-fbm-handle="your-handle"
  data-fbm-api="https://api.freeblackmarket.com"
  async
></script>
```

That's the same SDK any vendor can drop on their own existing site — see the
[FBM Connect guide](https://freeblackmarket.com) for the full API.

## One-time setup (FBM operators)

1. Push this directory to `Blackmarket-coa/fbm-site-template`.
2. In repo **Settings → General**, tick **Template repository**.
3. In repo **Settings → Pages**, set **Source: GitHub Actions**.
4. On the FBM backend, set `GITHUB_TOKEN` (a PAT/app token with `repo` +
   `workflow` scope on the org), `GITHUB_ORG`, and `SITE_TEMPLATE_REPO`
   (`Blackmarket-coa/fbm-site-template`).
5. Point `*.sites.freeblackmarket.com` DNS at GitHub Pages (or a Cloudflare
   Tunnel) so the per-vendor `CNAME` resolves.

## Customizing

Edit `index.html` and `styles.css` freely. The product/event grids are styled by
`connect.js` under `.fbm-*` classes, which you can override in `styles.css`.
