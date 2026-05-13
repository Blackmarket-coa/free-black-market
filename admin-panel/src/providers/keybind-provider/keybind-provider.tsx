import type { PropsWithChildren} from "react";
import { useCallback, useMemo, useState } from "react"

import { useShortcuts } from "@providers/keybind-provider/hooks"
import { KeybindContext } from "@providers/keybind-provider/keybind-context"
import type { KeybindContextState, Shortcut } from "@providers/keybind-provider/types"
import {
  findFirstPlatformMatch,
  findShortcutIndex,
  getShortcutKeys,
  getShortcutWithDefaultValues,
} from "@providers/keybind-provider/utils"

type KeybindProviderProps = PropsWithChildren<{
  shortcuts: Shortcut[]
  debounce?: number
}>

export const KeybindProvider = ({
  shortcuts,
  debounce = 500,
  children,
}: KeybindProviderProps) => {
  const [storeShortcuts, setStoreCommands] = useState(
    shortcuts.map((shr) => getShortcutWithDefaultValues(shr))
  )
  const registerShortcut = useCallback(
    (shortcut: Shortcut) => {
      setStoreCommands((prevShortcuts) => {
        const idx = findShortcutIndex(shortcuts, getShortcutKeys(shortcut))

        const newShortcuts = [...prevShortcuts]

        if (idx > -1) {
          newShortcuts[idx] = getShortcutWithDefaultValues(shortcut)
          
return prevShortcuts
        }

        return [...prevShortcuts, getShortcutWithDefaultValues(shortcut)]
      })
    },
    [shortcuts]
  )

  const getKeysByPlatform = useCallback((command: Shortcut) => {
    return findFirstPlatformMatch(command.keys)
  }, [])

  useShortcuts({ shortcuts: storeShortcuts, debounce })

  const commandsContext = useMemo<KeybindContextState>(
    () => ({
      shortcuts: storeShortcuts,
      registerShortcut,
      getKeysByPlatform,
    }),
    [storeShortcuts, registerShortcut, getKeysByPlatform]
  )

  return (
    <KeybindContext.Provider value={commandsContext}>
      {children}
    </KeybindContext.Provider>
  )
}
