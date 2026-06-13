import { logger } from "@/lib/logger"
import { Footer, Header } from "@/components/organisms"
import { BackToTop } from "@/components/atoms"
import { MobileLauncher } from "@/components/molecules"
import { retrieveCustomer } from "@/lib/data/customer"
import { checkRegion } from "@/lib/helpers/check-region"
import { MatrixChatProvider } from "@/providers/MatrixChatProvider"
import { AnalyticsEventBinder } from "@/components/providers/AnalyticsEventBinder"
import { redirect } from "next/navigation"

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const MATRIX_ELEMENT_URL = process.env.NEXT_PUBLIC_MATRIX_ELEMENT_URL
  const { locale } = await params

  let user = null
  let regionIsValid = false

  // --- Region validation (must never crash) ---
  try {
    regionIsValid = await checkRegion(locale)
  } catch (error) {
    logger.error("[RootLayout] Region check failed:", error)
  }

  if (!regionIsValid) {
    redirect("/")
  }

  // --- Customer retrieval (anonymous-safe) ---
  try {
    user = await retrieveCustomer()
  } catch {
    // Expected for logged-out users
    user = null
  }

  // --- Default layout (no Matrix chat) ---
  if (!MATRIX_ELEMENT_URL || !user) {
    return (
      <>
        <Header />
        <AnalyticsEventBinder />
        {children}
        <Footer />
        <BackToTop />
        <MobileLauncher />
      </>
    )
  }

  // --- Authenticated layout with Matrix chat ---
  return (
    <>
      <MatrixChatProvider>
        <Header />
        <AnalyticsEventBinder />
        {children}
        <Footer />
        <BackToTop />
        <MobileLauncher />
      </MatrixChatProvider>
    </>
  )
}
