// Practitioner identity. In production this comes from the vendor session;
// the VITE_PRACTITIONER_* env vars are local-dev shortcuts.
export function usePractitioner(): {
  practitionerId: string
  practitionerName: string
} {
  return {
    practitionerId: import.meta.env.VITE_PRACTITIONER_ID || "malinda-ellis",
    practitionerName: import.meta.env.VITE_PRACTITIONER_NAME || "Shakti Innergy",
  }
}
