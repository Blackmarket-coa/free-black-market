import {
  DEFAULT_FISCAL_SPONSOR,
  deriveDonationSettingsFields,
  FISCAL_SPONSOR_KEYS,
  FISCAL_SPONSORS,
  isFiscalSponsorKey,
  resolveActiveFiscalSponsor,
  type FiscalSponsor,
} from "../fiscal-sponsors"

describe("fiscal-sponsors: registry", () => {
  it("exposes the four documented candidates", () => {
    expect(FISCAL_SPONSOR_KEYS).toEqual([
      "allied_media_projects",
      "neo_philanthropy",
      "tides_foundation",
      "selc_local",
    ])
  })

  it("AMP is the default per docs/FISCAL_SPONSOR_DECISION.md", () => {
    expect(DEFAULT_FISCAL_SPONSOR).toBe("allied_media_projects")
  })

  it("each candidate has a display name + tagline", () => {
    for (const key of FISCAL_SPONSOR_KEYS) {
      const sponsor = FISCAL_SPONSORS[key]
      expect(sponsor.name).toBeTruthy()
      expect(sponsor.tagline).toBeTruthy()
    }
  })

  it("ships every candidate as not-live (agreement pending)", () => {
    // Safety invariant: a registry entry must NOT be hard-coded `live`.
    // Going live is gated on the FBM_FISCAL_SPONSOR_LIVE env flag so
    // accidentally merging "live: true" can't bypass the agreement.
    for (const key of FISCAL_SPONSOR_KEYS) {
      expect(FISCAL_SPONSORS[key].live).toBe(false)
      expect(FISCAL_SPONSORS[key].ledger_account_id).toBeNull()
    }
  })
})

describe("fiscal-sponsors: isFiscalSponsorKey", () => {
  it.each(FISCAL_SPONSOR_KEYS)("accepts %s", (key) => {
    expect(isFiscalSponsorKey(key)).toBe(true)
  })

  it.each(["", null, undefined, "AlliedMediaProjects", "amp", 42])(
    "rejects %p",
    (val) => {
      expect(isFiscalSponsorKey(val)).toBe(false)
    }
  )
})

describe("fiscal-sponsors: resolveActiveFiscalSponsor", () => {
  it("returns the default when no env override is set", () => {
    const sponsor = resolveActiveFiscalSponsor({})
    expect(sponsor.key).toBe(DEFAULT_FISCAL_SPONSOR)
    expect(sponsor.name).toBe("Allied Media Projects")
    expect(sponsor.live).toBe(false)
    expect(sponsor.ledger_account_id).toBeNull()
  })

  it("honours FBM_FISCAL_SPONSOR_PROVIDER when set to a known key", () => {
    const sponsor = resolveActiveFiscalSponsor({
      FBM_FISCAL_SPONSOR_PROVIDER: "tides_foundation",
    })
    expect(sponsor.key).toBe("tides_foundation")
    expect(sponsor.name).toBe("Tides Foundation")
  })

  it("falls back to the default for unknown provider values", () => {
    const sponsor = resolveActiveFiscalSponsor({
      FBM_FISCAL_SPONSOR_PROVIDER: "nonsense",
    })
    expect(sponsor.key).toBe(DEFAULT_FISCAL_SPONSOR)
  })

  it("flips live=true when FBM_FISCAL_SPONSOR_LIVE=true", () => {
    const sponsor = resolveActiveFiscalSponsor({
      FBM_FISCAL_SPONSOR_LIVE: "true",
    })
    expect(sponsor.live).toBe(true)
  })

  it("does not flip live on stray truthy strings (must be exactly 'true')", () => {
    expect(
      resolveActiveFiscalSponsor({ FBM_FISCAL_SPONSOR_LIVE: "1" }).live
    ).toBe(false)
    expect(
      resolveActiveFiscalSponsor({ FBM_FISCAL_SPONSOR_LIVE: "yes" }).live
    ).toBe(false)
  })

  it("explicitly accepts 'false' to assert live=false even if registry flips later", () => {
    const sponsor = resolveActiveFiscalSponsor({
      FBM_FISCAL_SPONSOR_LIVE: "false",
    })
    expect(sponsor.live).toBe(false)
  })

  it("picks up ledger_account_id from env when provided", () => {
    const sponsor = resolveActiveFiscalSponsor({
      FBM_FISCAL_SPONSOR_LEDGER_ACCOUNT_ID: "ledger_amp_donation_account",
    })
    expect(sponsor.ledger_account_id).toBe("ledger_amp_donation_account")
  })

  it("ignores empty-string ledger override (treated as not set)", () => {
    const sponsor = resolveActiveFiscalSponsor({
      FBM_FISCAL_SPONSOR_LEDGER_ACCOUNT_ID: "",
    })
    expect(sponsor.ledger_account_id).toBeNull()
  })

  it("composes env overrides with the chosen provider", () => {
    const sponsor = resolveActiveFiscalSponsor({
      FBM_FISCAL_SPONSOR_PROVIDER: "neo_philanthropy",
      FBM_FISCAL_SPONSOR_LIVE: "true",
      FBM_FISCAL_SPONSOR_LEDGER_ACCOUNT_ID: "ledger_neo_test",
    })
    expect(sponsor.key).toBe("neo_philanthropy")
    expect(sponsor.live).toBe(true)
    expect(sponsor.ledger_account_id).toBe("ledger_neo_test")
  })
})

describe("fiscal-sponsors: deriveDonationSettingsFields", () => {
  const baseSponsor: FiscalSponsor = {
    key: "allied_media_projects",
    name: "Allied Media Projects",
    url: "https://alliedmedia.org",
    tagline: "—",
    live: false,
    ledger_account_id: "ledger_amp_pending",
  }

  it("surfaces display fields", () => {
    const fields = deriveDonationSettingsFields(baseSponsor)
    expect(fields.fiscal_sponsor_name).toBe("Allied Media Projects")
    expect(fields.fiscal_sponsor_url).toBe("https://alliedmedia.org")
  })

  it("withholds ledger_account_id until the sponsor is live", () => {
    expect(
      deriveDonationSettingsFields({ ...baseSponsor, live: false })
        .fiscal_sponsor_account_id
    ).toBeNull()
  })

  it("surfaces ledger_account_id only when live=true", () => {
    expect(
      deriveDonationSettingsFields({ ...baseSponsor, live: true })
        .fiscal_sponsor_account_id
    ).toBe("ledger_amp_pending")
  })

  it("null ledger + live=true still resolves to null (defensive)", () => {
    expect(
      deriveDonationSettingsFields({
        ...baseSponsor,
        live: true,
        ledger_account_id: null,
      }).fiscal_sponsor_account_id
    ).toBeNull()
  })
})
