import { Routes, Route, Navigate } from "react-router-dom"
import { PortalLayout } from "@/components/layout/PortalLayout"

import { DashboardPage } from "@/pages/DashboardPage"
import { BookingCalendarPage } from "@/pages/BookingCalendarPage"
import { SessionsPage } from "@/pages/SessionsPage"
import { ClassesPage } from "@/pages/ClassesPage"
import { DigitalProductsPage } from "@/pages/DigitalProductsPage"
import { PhysicalProductsPage } from "@/pages/PhysicalProductsPage"
import { MembershipsPage } from "@/pages/MembershipsPage"
import { ClientsPage } from "@/pages/ClientsPage"
import { PayoutsPage } from "@/pages/PayoutsPage"
import { BlackoutPage } from "@/pages/BlackoutPage"
import { AnalyticsPage } from "@/pages/AnalyticsPage"
import { ConnectEmbedPage } from "@/pages/ConnectEmbedPage"
import { QuestsPage } from "@/pages/QuestsPage"

export function App() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/calendar" element={<BookingCalendarPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/classes" element={<ClassesPage />} />
        <Route path="/digital" element={<DigitalProductsPage />} />
        <Route path="/products" element={<PhysicalProductsPage />} />
        <Route path="/memberships" element={<MembershipsPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/blackout" element={<BlackoutPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/embed" element={<ConnectEmbedPage />} />
        <Route path="/quests" element={<QuestsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
