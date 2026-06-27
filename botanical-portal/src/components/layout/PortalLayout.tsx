import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { TopBar } from "./TopBar"

// App shell: fixed top bar, sidebar (icon rail on mobile, full on md+), and a
// scrolling content area. Sidebar column narrows under md.
export function PortalLayout() {
  return (
    <div className="grid h-screen overflow-hidden grid-rows-[48px_1fr] grid-cols-[56px_1fr] md:grid-cols-[220px_1fr]">
      <TopBar />
      <Sidebar />
      <main className="overflow-y-auto scroll-area p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  )
}
