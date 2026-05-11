"use client"

import {
  CartIcon,
  HeartIcon,
  HomeIcon,
  LeafIcon,
  ProfileIcon,
} from "@/icons"
import {
  RadialLauncher,
  type RadialLauncherItem,
} from "@/components/atoms/RadialLauncher/RadialLauncher"

/**
 * Mounted radial launcher for the storefront's `(main)` layout.
 *
 * Five-item quick nav, fanning upward from a bottom-centre FAB. Mobile
 * only — desktop has the full header nav.
 *
 * Item set is the today-shipping surface; the deferred composition-
 * layer surfaces (Refrain, Threshold, Blackstar) join this list as
 * they land. See docs/COMPOSITION_LAYER.md.
 */
const ITEMS: RadialLauncherItem[] = [
  {
    key: "home",
    label: "Home",
    href: "/",
    icon: <HomeIcon />,
  },
  {
    key: "shop",
    label: "Shop",
    href: "/shop",
    icon: <LeafIcon />,
  },
  {
    key: "cart",
    label: "Cart",
    href: "/cart",
    icon: <CartIcon />,
  },
  {
    key: "donate",
    label: "Donate",
    href: "/donations",
    icon: <HeartIcon />,
  },
  {
    key: "account",
    label: "Account",
    href: "/user",
    icon: <ProfileIcon />,
  },
]

export function MobileLauncher() {
  return <RadialLauncher items={ITEMS} />
}
