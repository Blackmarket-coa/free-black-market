import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Enable a self-contained build output so the production Dockerfile can
  // copy `.next/standalone` instead of installing the full dep tree at runtime.
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  trailingSlash: false,
  reactStrictMode: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  // Security headers
  async headers() {
    return [
      // Default: deny iframe embedding for the whole site.
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // Creator embeddable widget: explicitly relax frame-ancestors so any
      // origin can iframe `/creators/[handle]/widget`. Origin allowlisting is
      // enforced on the backend via the AffiliateLink.allowed_origins field
      // when the widget redirects back through /r/:shortCode.
      {
        source: "/:locale/creators/:handle/widget",
        headers: [
          {
            key: "X-Frame-Options",
            value: "ALLOWALL",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
      // Embed JS bundle: served as a static asset; allow CORS so any site
      // can <script src="..."> it. The bundle itself is the same origin as
      // the iframe target so X-Frame-Options doesn't apply.
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
          {
            key: "Cache-Control",
            value: "public, max-age=300",
          },
        ],
      },
      // FBM Connect SDK (connect.js): the single <script> any vendor drops on
      // their own site. Open CORS + long, immutable-friendly caching so CDNs
      // and browsers absorb the load; nosniff to lock the JS content type.
      {
        source: "/connect.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Cache-Control",
            value: "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      // Frozen SDK releases (/v2.0.0/connect.js, …): the pinnable channel the
      // vendor snippet embeds with SRI. A release directory is never edited
      // after it ships — connect-sri.unit.spec.ts (backend) enforces that the
      // mutable /connect.js, the frozen copy of its declared version, and the
      // published integrity hash all agree — so true immutable caching is safe.
      {
        source: "/:version(v\\d+\\.\\d+\\.\\d+)/connect.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: "/collective-demand-pools",
        destination: "/collective/demand-pools",
        permanent: true,
      },
      {
        source: "/collective-demand-pools/:path*",
        destination: "/collective/demand-pools/:path*",
        permanent: true,
      },
    ]
  },
  images: {
    // Railway deployments can intermittently time out on server-side image optimization
    // for remote object storage URLs. Serving remote images directly avoids upstream
    // optimizer timeouts while still allowing the same remote hosts.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "medusa-public-images.s3.eu-west-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "mercur-connect.s3.eu-central-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "api.mercurjs.com",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "api-sandbox.mercurjs.com",
        pathname: "/static/**",
      },
      {
        protocol: "https",
        hostname: "i.imgur.com",
      },
      {
        protocol: "https",
        hostname: "s3.eu-central-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "bucket-production-20af.up.railway.app",
        pathname: "/medusa-media/**",
      },
    ],
  },
}

// Wrap with Sentry so production client/server bundles ship source maps to
// Sentry (readable, un-minified stack traces). Source-map UPLOAD only happens
// when SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN are present at build
// time; without them the build still succeeds (maps just aren't uploaded), so
// this is safe in every environment. Compatible with `output: "standalone"`.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { withSentryConfig } = require("@sentry/nextjs")

module.exports = withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Tree-shake the Sentry SDK logger out of the client bundle.
  disableLogger: true,
  // Upload a wider set of client source maps for readable browser stack traces.
  widenClientFileUpload: true,
})
