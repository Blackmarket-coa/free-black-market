import { Routes, Route, Navigate } from "react-router-dom"
import { PortalLayout } from "@/components/layout/PortalLayout"
import { useRole } from "@/hooks/useRole"

import { DashboardPage } from "@/pages/DashboardPage"
import { InventoryPage } from "@/pages/InventoryPage"
import { PropagationPage } from "@/pages/PropagationPage"
import { OrdersPage } from "@/pages/OrdersPage"
import { PayoutsPage } from "@/pages/PayoutsPage"
import { BlackoutPage } from "@/pages/BlackoutPage"

// Stub pages (placeholder surfaces; full builds are follow-ups)
import { ListingsPage } from "@/pages/ListingsPage"
import { SeasonalPlannerPage } from "@/pages/SeasonalPlannerPage"
import { QuestsPage } from "@/pages/QuestsPage"
import { AnalyticsPage } from "@/pages/AnalyticsPage"
import { NetworkPage } from "@/pages/NetworkPage"
import { WholesalePage } from "@/pages/WholesalePage"

export function App() {
  const { role } = useRole()

  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/propagation" element={<PropagationPage />} />
        <Route path="/listings" element={<ListingsPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/seasonal" element={<SeasonalPlannerPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/quests" element={<QuestsPage />} />
        <Route path="/blackout" element={<BlackoutPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        {role === "hub" && (
          <>
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/wholesale" element={<WholesalePage />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
