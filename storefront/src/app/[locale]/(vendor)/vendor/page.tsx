import { redirect } from "next/navigation"

/** `/vendor` is just an entry point — the surface is the order inbox. */
export default async function VendorIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/vendor/orders`)
}
