"use client"

import { useState, useTransition } from "react"
import { Card } from "@/components/atoms/Card/Card"
import { Button, Heading, Text } from "@medusajs/ui"
import {
  deleteCustomerAccount,
  exportCustomerData,
} from "@/lib/data/customer"

/**
 * Account-settings controls for a person's data rights (CCPA/CPRA):
 *  - "Download my data" exports everything we hold as a JSON file.
 *  - "Delete my account" erases personal data and signs the account out.
 *
 * Both call server actions that scope strictly to the authenticated customer.
 */
export const PrivacyDataSettings = () => {
  const [exporting, startExport] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleExport = () => {
    setError(null)
    setMessage(null)
    startExport(async () => {
      const result = await exportCustomerData()
      if (!result.success) {
        setError(result.error)
        return
      }
      try {
        const blob = new Blob([JSON.stringify(result.data, null, 2)], {
          type: "application/json",
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "fbm-data-export.json"
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        setMessage("Your data export has downloaded.")
      } catch {
        setError("Could not start the download. Please try again.")
      }
    })
  }

  const handleDelete = () => {
    setError(null)
    setMessage(null)
    startDelete(async () => {
      const result = await deleteCustomerAccount()
      if (!result.success) {
        setError(result.error)
        setConfirmingDelete(false)
        return
      }
      // Session is cleared server-side; leave the authenticated area.
      window.location.href = "/"
    })
  }

  return (
    <Card className="mt-6 p-6">
      <Heading level="h2" className="text-lg mb-1">
        Privacy &amp; your data
      </Heading>
      <Text className="text-ui-fg-subtle mb-4">
        Download a copy of your personal data, or permanently delete your
        account.
      </Text>

      <div className="flex flex-col gap-4 max-w-xl">
        <div className="flex flex-col gap-2">
          <Text className="font-medium">Download my data</Text>
          <Text className="text-ui-fg-subtle text-sm">
            Exports your profile, saved addresses, and order history as a JSON
            file.
          </Text>
          <div>
            <Button
              variant="secondary"
              onClick={handleExport}
              isLoading={exporting}
            >
              Download my data
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-ui-border-base pt-4">
          <Text className="font-medium">Delete my account</Text>
          <Text className="text-ui-fg-subtle text-sm">
            Permanently erases your personal data and signs you out. Completed
            orders are kept in anonymised form for tax/accounting. This cannot be
            undone.
          </Text>
          {!confirmingDelete ? (
            <div>
              <Button
                variant="danger"
                onClick={() => setConfirmingDelete(true)}
                disabled={deleting}
              >
                Delete my account
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Text className="text-sm">Are you sure? This is permanent.</Text>
              <Button variant="danger" onClick={handleDelete} isLoading={deleting}>
                Yes, delete
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>

        {message ? (
          <Text className="text-ui-fg-interactive text-sm">{message}</Text>
        ) : null}
        {error ? (
          <Text className="text-ui-fg-error text-sm">{error}</Text>
        ) : null}
      </div>
    </Card>
  )
}
