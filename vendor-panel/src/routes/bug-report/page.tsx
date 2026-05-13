import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ExclamationCircle } from "@medusajs/icons"
import { BugReportForm } from "../../components/bug-report/bug-report-form"
import { sdk } from "../../lib/sdk"

const BugReportPage = () => {
  return (
    <BugReportForm
      title="Report a bug"
      subtitle="Submits an issue to the public GitHub tracker so the community can help fix it."
      submit={(payload) =>
        sdk.client.fetch<{ url: string; number: number }>("/vendor/bug-report", {
          method: "POST",
          body: payload,
        })
      }
    />
  )
}

export const config = defineRouteConfig({
  label: "Report a bug",
  icon: ExclamationCircle,
})

export default BugReportPage
