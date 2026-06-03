import { decideDealAction } from "../steps/_decide-deal-action"
import { CreatorApplicationStatus } from "../../../modules/creator-program/models/creator-application"
import { CreatorDealStatus } from "../../../modules/creator-program/models/creator-deal"

describe("decideDealAction (launch creator-consent gate)", () => {
  it("invites when the creator has no application and no deal", () => {
    expect(decideDealAction([], [])).toEqual({ action: "invite" })
  })

  it("invites when the only application is still pending (no consent yet)", () => {
    const apps = [{ id: "app_1", status: CreatorApplicationStatus.PENDING }]
    expect(decideDealAction(apps, [])).toEqual({ action: "invite" })
  })

  it("invites when applications are rejected/withdrawn", () => {
    const apps = [
      { id: "app_1", status: CreatorApplicationStatus.REJECTED },
      { id: "app_2", status: CreatorApplicationStatus.WITHDRAWN },
    ]
    expect(decideDealAction(apps, [])).toEqual({ action: "invite" })
  })

  it("opens a deal for an approved application", () => {
    const apps = [{ id: "app_42", status: CreatorApplicationStatus.APPROVED }]
    expect(decideDealAction(apps, [])).toEqual({
      action: "open_deal",
      applicationId: "app_42",
    })
  })

  it("reuses an existing ACTIVE deal in preference to re-opening", () => {
    const apps = [{ id: "app_42", status: CreatorApplicationStatus.APPROVED }]
    const deals = [{ id: "deal_7", status: CreatorDealStatus.ACTIVE }]
    expect(decideDealAction(apps, deals)).toEqual({
      action: "reuse_deal",
      dealId: "deal_7",
    })
  })

  it("ignores non-active deals (canceled/expired) and falls through to consent", () => {
    const apps = [{ id: "app_42", status: CreatorApplicationStatus.APPROVED }]
    const deals = [
      { id: "deal_old", status: CreatorDealStatus.CANCELED },
      { id: "deal_exp", status: CreatorDealStatus.EXPIRED },
    ]
    expect(decideDealAction(apps, deals)).toEqual({
      action: "open_deal",
      applicationId: "app_42",
    })
  })

  it("invites when only a canceled deal exists and no approved application", () => {
    const deals = [{ id: "deal_old", status: CreatorDealStatus.CANCELED }]
    expect(decideDealAction([], deals)).toEqual({ action: "invite" })
  })
})
