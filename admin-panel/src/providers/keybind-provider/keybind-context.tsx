import { createContext } from "react"
import type { KeybindContextState } from "@providers/keybind-provider/types"

export const KeybindContext = createContext<KeybindContextState | null>(null)
