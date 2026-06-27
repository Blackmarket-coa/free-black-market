import { Routes, Route, Navigate } from "react-router-dom"
import { PortalLayout } from "@/components/layout/PortalLayout"

import { DashboardPage } from "@/pages/DashboardPage"
import { MembershipsPage } from "@/pages/MembershipsPage"
import { CreditsPage } from "@/pages/CreditsPage"
import { BoostsPage } from "@/pages/BoostsPage"
import { SplitsPage } from "@/pages/SplitsPage"
import { StreamPage } from "@/pages/StreamPage"
import { BlackoutPage } from "@/pages/BlackoutPage"
import { PayoutsPage } from "@/pages/PayoutsPage"
import { AnalyticsPage } from "@/pages/AnalyticsPage"
import { ConnectEmbedPage } from "@/pages/ConnectEmbedPage"
import { QuestsPage } from "@/pages/QuestsPage"

export function App() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/memberships" element={<MembershipsPage />} />
        <Route path="/credits" element={<CreditsPage />} />
        <Route path="/boosts" element={<BoostsPage />} />
        <Route path="/splits" element={<SplitsPage />} />
        <Route path="/stream" element={<StreamPage />} />
        <Route path="/blackout" element={<BlackoutPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/embed" element={<ConnectEmbedPage />} />
        <Route path="/quests" element={<QuestsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
