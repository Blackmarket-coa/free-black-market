"use client"

import {
  CharacterIcon,
  CompassIcon,
  HomeIcon,
  QuestIcon,
  UsersIcon,
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
 * The item set follows the Solarpunk-MMORPG navigation model: Home,
 * Explore (the market/regions), Quests (collective demand & bounties),
 * Coalition (mutual aid & community), and Character (the player's
 * levelled profile). See docs/SOLARPUNK_MMORPG_BLUEPRINT.md.
 */
const ITEMS: RadialLauncherItem[] = [
  {
    key: "home",
    label: "Home",
    href: "/",
    icon: <HomeIcon />,
  },
  {
    key: "explore",
    label: "Explore",
    href: "/shop",
    icon: <CompassIcon />,
  },
  {
    key: "quests",
    label: "Quests",
    href: "/collective",
    icon: <QuestIcon />,
  },
  {
    key: "coalition",
    label: "Coalition",
    href: "/community-resources",
    icon: <UsersIcon />,
  },
  {
    key: "character",
    label: "Character",
    href: "/character",
    icon: <CharacterIcon />,
  },
]

export function MobileLauncher() {
  return <RadialLauncher items={ITEMS} />
}
