"use client"
import {
  Badge,
  Card,
  Divider,
  LogoutButton,
  NavigationItem,
} from "@/components/atoms"
import { BugReportButton } from "@/components/molecules/BugReportButton/BugReportButton"
import { useMatrixChat } from "@/providers/MatrixChatProvider"
import { usePathname } from "next/navigation"

const navigationItems = [
  {
    label: "Orders",
    href: "/user/orders",
  },
  {

    label: "Messages",
    href: "/user/messages",
  },
  {
    label: "Returns",
    href: "/user/returns",
  },
  {
    label: "Addresses",
    href: "/user/addresses",
  },
  {
    label: "Reviews",
    href: "/user/reviews",
  },
  {
    label: "Wishlist",
    href: "/user/wishlist",
  },
  {
    label: "Coalition Credits",
    href: "/user/coalition-credits",
  },
]

export const UserNavigation = () => {
  const { unreadCount } = useMatrixChat()
  const path = usePathname()

  return (
    <Card className="h-min">
      {navigationItems.map((item) => (
        <NavigationItem
          key={item.label}
          href={item.href}
          active={path === item.href}
          className="relative"
        >
          {item.label}
          {item.label === "Messages" && unreadCount > 0 && (
            <Badge className="absolute top-3 left-24 w-4 h-4 p-0">
              {unreadCount}
            </Badge>
          )}
        </NavigationItem>
      ))}
      <Divider className="my-2" />
      <NavigationItem
        href={"/user/settings"}
        active={path === "/user/settings"}
      >
        Settings
      </NavigationItem>
      <BugReportButton variant="menu-item" className="px-4" />
      <LogoutButton className="w-full text-left" />
    </Card>
  )
}
