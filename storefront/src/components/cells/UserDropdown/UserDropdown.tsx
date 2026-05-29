"use client"

import {
  Badge,
  Divider,
  LogoutButton,
  NavigationItem,
} from "@/components/atoms"
import { Dropdown } from "@/components/molecules"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { ProfileIcon } from "@/icons"
import { HttpTypes } from "@medusajs/types"
import { useMatrixChat } from "@/providers/MatrixChatProvider"
import { useState } from "react"

// User Avatar with initials
const UserAvatar = ({ user }: { user: HttpTypes.StoreCustomer }) => {
  const initials = `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'U'
  
  return (
    <div className="w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-xs font-semibold">
      {initials}
    </div>
  )
}

export const UserDropdown = ({
  user,
}: {
  user: HttpTypes.StoreCustomer | null
}) => {
  const [open, setOpen] = useState(false)

  const { unreadCount } = useMatrixChat()

  return (
    <div
      className="relative"
      onMouseOver={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
    >
      <LocalizedClientLink
        href="/user"
        className="relative flex items-center"
        aria-label="Go to user profile"
      >
        {user ? (
          <UserAvatar user={user} />
        ) : (
          <ProfileIcon size={20} />
        )}
      </LocalizedClientLink>
      <Dropdown show={open}>
        {user ? (
          <div className="p-1">
            <div className="lg:w-[220px]">
              {/* User info header */}
              <div className="p-4 border-b">
                <div className="flex items-center gap-3">
                  <UserAvatar user={user} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {user.first_name} {user.last_name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  </div>
                </div>
              </div>
            </div>
            <NavigationItem href="/user/orders">Orders</NavigationItem>
            <NavigationItem href="/user/messages" className="relative">
              Messages
              {unreadCount > 0 && (
                <Badge className="absolute top-3 left-24 w-4 h-4 p-0">
                  {unreadCount}
                </Badge>
              )}
            </NavigationItem>
            <NavigationItem href="/user/returns">Returns</NavigationItem>
            <NavigationItem href="/user/addresses">Addresses</NavigationItem>
            <NavigationItem href="/user/reviews">Reviews</NavigationItem>
            <NavigationItem href="/user/wishlist">Wishlist</NavigationItem>
            <Divider />
            <NavigationItem href="/user/settings">Settings</NavigationItem>
            <LogoutButton />
          </div>
        ) : (
          <div className="p-1">
            <NavigationItem href="/user">Login</NavigationItem>
            <NavigationItem href="/user/register">Register</NavigationItem>
          </div>
        )}
      </Dropdown>
    </div>
  )
}
