// Creator identity. In production this comes from the FBM vendor session; the
// VITE_CREATOR_* env vars are local-dev shortcuts.
export function useCreator(): {
  creatorId: string
  creatorName: string
  spaceId: string
} {
  return {
    creatorId: import.meta.env.VITE_CREATOR_ID || "nova-strand",
    creatorName: import.meta.env.VITE_CREATOR_NAME || "Nova Strand",
    spaceId: import.meta.env.VITE_CREATOR_SPACE_ID || "!coalition:theblackout.app",
  }
}
