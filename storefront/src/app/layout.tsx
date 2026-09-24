import type { Metadata } from "next"
import { Exo_2, Urbanist } from "next/font/google"
import "./globals.css"
import { Toaster } from "@medusajs/ui"
import Head from "next/head"
import { cookies } from "next/headers"
import { retrieveCart } from "@/lib/data/cart"
import { NativeAppBridge } from "@/components/providers"
import { ConsentBanner } from "@/components/molecules/ConsentBanner/ConsentBanner"
import { readConsent } from "@/lib/consent"
import { Providers } from "./providers"

const exo2 = Exo_2({
  variable: "--font-solarpunk-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

const urbanist = Urbanist({
  variable: "--font-solarpunk-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
})

// Ensure metadataBase is always a valid URL
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.freeblackmarket.com"

export const metadata: Metadata = {
  title: {
    template: `%s | ${
      process.env.NEXT_PUBLIC_SITE_NAME || "Black Market Coalition"
    }`,
    default: process.env.NEXT_PUBLIC_SITE_NAME || "Black Market Coalition",
  },
  description: process.env.NEXT_PUBLIC_SITE_DESCRIPTION || "Black Market Coalition",
  metadataBase: new URL(BASE_URL),
  alternates: {
    languages: {
      "x-default": BASE_URL,
    },
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cart = await retrieveCart()
  // LEG-8: decide the banner's initial state on the server so a returning
  // visitor never sees it flash before hydration.
  const consent = readConsent(await cookies())
  const ALGOLIA_APP = process.env.NEXT_PUBLIC_ALGOLIA_ID
  const htmlLang = "en"
  
  return (
    <html lang={htmlLang} className="">
      <Head>
        {/* Favicons */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        
        {/* Preconnect and DNS prefetch */}
        <link
          rel="preconnect"
          href="https://i.imgur.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://i.imgur.com" />
        {ALGOLIA_APP && (
          <>
            <link
              rel="preconnect"
              href="https://algolia.net"
              crossOrigin="anonymous"
            />
            <link
              rel="preconnect"
              href="https://algolianet.com"
              crossOrigin="anonymous"
            />
            <link rel="dns-prefetch" href="https://algolia.net" />
            <link rel="dns-prefetch" href="https://algolianet.com" />
          </>
        )}
        <link
          rel="preconnect"
          href="https://medusa-public-images.s3.eu-west-1.amazonaws.com"
          crossOrigin="anonymous"
        />
        <link
          rel="dns-prefetch"
          href="https://medusa-public-images.s3.eu-west-1.amazonaws.com"
        />
        <link
          rel="preconnect"
          href="https://mercur-connect.s3.eu-central-1.amazonaws.com"
          crossOrigin="anonymous"
        />
        <link
          rel="dns-prefetch"
          href="https://mercur-connect.s3.eu-central-1.amazonaws.com"
        />
        <link
          rel="preconnect"
          href="https://s3.eu-central-1.amazonaws.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://s3.eu-central-1.amazonaws.com" />
        <link
          rel="preconnect"
          href="https://api.mercurjs.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://api.mercurjs.com" />
      </Head>
      <body
        className={`${exo2.variable} ${urbanist.variable} ${urbanist.className} antialiased bg-primary text-secondary relative solarpunk-atmosphere`}
      >
        {/* First in the DOM so keyboard and screen-reader users meet the
            choice before the page; it is fixed to the bottom visually. Later
            z-50 layers (the mobile menu, modals) now paint over it, which is
            intended: an open menu or dialog belongs on top. */}
        <ConsentBanner initialConsent={consent} />
        <Providers cart={cart}>{children}</Providers>
        {/* Capacitor shell integration (deep links, push) — no-op on the web */}
        <NativeAppBridge />
        <Toaster position="top-right" />
      </body>
    </html>
  )
}
