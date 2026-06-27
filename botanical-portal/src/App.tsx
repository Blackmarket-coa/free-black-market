import { Routes, Route, Navigate } from "react-router-dom"
import { PortalLayout } from "@/components/layout/PortalLayout"
import { useOperatorType } from "@/hooks/useOperatorType"

// Full pathway-aware pages
import { DashboardPage } from "@/pages/DashboardPage"
import { PathwaysPage } from "@/pages/PathwaysPage"
import { ProductionPage } from "@/pages/ProductionPage"
import { FormulasPage } from "@/pages/FormulasPage"
import { RawMaterialsPage } from "@/pages/RawMaterialsPage"
import { FinishedGoodsPage } from "@/pages/FinishedGoodsPage"
import { CompliancePage } from "@/pages/CompliancePage"

// Stub pages (scaffolded surfaces; full builds are follow-ups)
import { ListingsPage } from "@/pages/ListingsPage"
import { WholesalePage } from "@/pages/WholesalePage"
import { OrdersPage } from "@/pages/OrdersPage"
import { NurseryNetworkPage } from "@/pages/NurseryNetworkPage"
import { PayoutsPage } from "@/pages/PayoutsPage"
import { AnalyticsPage } from "@/pages/AnalyticsPage"
import { QuestsPage } from "@/pages/QuestsPage"
import { BlackoutPage } from "@/pages/BlackoutPage"
import { MakersPage } from "@/pages/MakersPage"
import { CollectiveSplitsPage } from "@/pages/CollectiveSplitsPage"

export function App() {
  const { isCollective } = useOperatorType()

  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/pathways" element={<PathwaysPage />} />
        <Route path="/production" element={<ProductionPage />} />
        <Route path="/formulas" element={<FormulasPage />} />
        <Route path="/raw-materials" element={<RawMaterialsPage />} />
        <Route path="/finished" element={<FinishedGoodsPage />} />
        <Route path="/listings" element={<ListingsPage />} />
        <Route path="/wholesale" element={<WholesalePage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/compliance" element={<CompliancePage />} />
        <Route path="/nursery" element={<NurseryNetworkPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/quests" element={<QuestsPage />} />
        <Route path="/blackout" element={<BlackoutPage />} />
        {isCollective && (
          <>
            <Route path="/makers" element={<MakersPage />} />
            <Route path="/pool-splits" element={<CollectiveSplitsPage />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
