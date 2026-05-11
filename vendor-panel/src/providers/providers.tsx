import { Toaster, TooltipProvider } from "@medusajs/ui"
import { QueryClientProvider } from "@tanstack/react-query"
import type { PropsWithChildren } from "react"
import { HelmetProvider } from "react-helmet-async"
import { I18n } from "../components/utilities/i18n"
import {
  DashboardExtensionManager,
  DashboardExtensionProvider,
} from "../extensions"
import { queryClient } from "../lib/query-client"
import { I18nProvider } from "./i18n-provider"
import { PlaybookProvider } from "./playbook-provider"
import { ThemeProvider } from "./theme-provider"
import { VendorTypeProvider } from "./vendor-type-provider"

type ProvidersProps = PropsWithChildren<{
  api: DashboardExtensionManager["api"]
}>

export const Providers = ({ api, children }: ProvidersProps) => {
  return (
    <TooltipProvider>
      <DashboardExtensionProvider api={api}>
        <HelmetProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <I18n />
              <I18nProvider>
                <VendorTypeProvider>
                  <PlaybookProvider>
                    {children}
                  </PlaybookProvider>
                </VendorTypeProvider>
              </I18nProvider>
              <Toaster />
            </ThemeProvider>
          </QueryClientProvider>
        </HelmetProvider>
      </DashboardExtensionProvider>
    </TooltipProvider>
  )
}
