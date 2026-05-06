import { expect, test } from "@playwright/test"

// Smoke test that the storefront renders its home shell. Deeper journeys
// (cart, checkout, vendor onboarding) are added incrementally as the QA
// suite expands; see docs/runbooks/RELEASE.md.
test("storefront home renders without server error", async ({ page }) => {
  const response = await page.goto("/")
  expect(response?.status()).toBeLessThan(500)
  await expect(page).toHaveTitle(/.+/)
})
