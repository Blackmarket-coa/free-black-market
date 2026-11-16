import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { acceptMemberInvitesWorkflow } from "@mercurjs/b2c-core/workflows"
import { createAuthenticatedSeller, authHeader, safe, AuthenticatedSeller } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * Who POST /vendor/wellness/automations/test may mail, on a real migrated
 * database with the real seller module, Mercur's own invite workflow and the
 * real `query.graph`. Only `createNotifications` is replaced: no email may be
 * sent from a test.
 *
 * The route's allow list used to be the store's profile `email` plus every
 * member's address. Both are lists the seller can grow, and the restriction
 * held only because two write paths happen to be broken:
 *   - POST /vendor/sellers/me copies `email` into the seller row with no
 *     verification; Medusa's `.strict()` on its body schema rejects it today.
 *   - Mercur creates an invited member with the invite's address whoever
 *     accepts, and the inviter can read the token; /vendor/invites/accept
 *     fails today.
 * So this does what a repaired path would do, directly: it writes the
 * profile email through the seller module (the call POST /vendor/sellers/me
 * makes), and it runs acceptMemberInvitesWorkflow (what the accept route
 * runs) for an invite created through the real POST /vendor/invites, from a
 * second login the seller owns. Each address must still be refused, while
 * the address the store was registered with still gets the test.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    describe("POST /vendor/wellness/automations/test: recipients the seller can write are refused", () => {
      const stranger = "stranger-profile@victim.example"
      const invitee = "invitee-team@victim.example"
      let seller: AuthenticatedSeller
      let notify: jest.SpyInstance

      const container = () => getContainer() as any
      const graphSeller = async () => {
        const query = container().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "seller",
          fields: ["email", "members.email", "invites.email", "invites.accepted"],
          filters: { id: seller.seller.id },
        })
        return data[0] as {
          email: string | null
          members: Array<{ email: string }>
          invites: Array<{ email: string; accepted: boolean }>
        }
      }
      const testSend = (to: string) =>
        safe(
          api.post(
            "/vendor/wellness/automations/test",
            { trigger: "booking_confirmed", recipient_email: to, vars: { name: "ARBITRARY TEXT" } },
            authHeader(seller.token)
          )
        )
      const mailedTo = () => notify.mock.calls.map(([p]) => (p as { to: string }).to)

      // The runner empties the database after each test, so each one makes
      // its own seller.
      beforeEach(async () => {
        seller = await createAuthenticatedSeller({ api, getContainer })
        notify = jest
          .spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications")
          .mockResolvedValue([] as never)
        // An enabled email template, so an allowed test really reaches the send.
        const tpl = await safe(
          api.post(
            "/vendor/wellness/automations",
            { trigger: "booking_confirmed", body: "Hello [name]", channel: "email", enabled: true },
            authHeader(seller.token)
          )
        )
        expect(tpl.status).toBe(201)
      })

      afterEach(() => notify.mockRestore())

      // The address the store was registered with keeps working throughout.
      const expectRegisteredStillSends = async () => {
        notify.mockClear()
        const res = await testSend(seller.email)
        expect(res.status).toBe(200)
        expect(mailedTo()).toEqual([seller.email])
      }

      it("sends to the address the store was registered with", async () => {
        const res = await testSend(seller.email.toUpperCase())
        expect(res.status).toBe(200)
        expect(res.data.result).toEqual({ sent: 1, skipped: 0 })
        expect(mailedTo()).toEqual([seller.email.toUpperCase()])
      })

      it("refuses the store's profile email once the seller has set it to a stranger", async () => {
        await container().resolve(SELLER_MODULE).updateSellers([{ id: seller.seller.id, email: stranger }])
        expect((await graphSeller()).email).toBe(stranger)

        const res = await testSend(stranger)
        expect(res.status).toBe(403)
        expect(res.data).toMatchObject({ type: "not_allowed" })
        expect(notify).not.toHaveBeenCalled()

        await expectRegisteredStillSends()
      })

      it("refuses a member made by accepting the seller's own invite from a second login", async () => {
        const invite = await safe(
          api.post("/vendor/invites", { email: invitee, role: "member" }, authHeader(seller.token))
        )
        expect(invite.status).toBe(201)

        // The seller holds the token (today through ?fields=token; read here
        // from the row so the case does not depend on that leak).
        const query = container().resolve(ContainerRegistrationKeys.QUERY)
        const {
          data: [row],
        } = await query.graph({
          entity: "member_invite",
          fields: ["token"],
          filters: { id: invite.data.invite.id },
        })

        const sock = `sock+${Date.now()}@attacker.example`
        const reg = await safe(api.post("/auth/seller/emailpass/register", { email: sock, password: `${Date.now()}-sock-pw` }))
        expect(reg.status).toBe(200)
        const [identity] = await container()
          .resolve(Modules.AUTH)
          .listAuthIdentities({ provider_identities: { entity_id: sock } })

        await acceptMemberInvitesWorkflow(container()).run({
          input: { invite: { token: row.token, name: "Sock" }, authIdentityId: identity.id },
        })
        const after = await graphSeller()
        expect(after.members.map((m) => m.email)).toEqual(expect.arrayContaining([seller.email, invitee]))
        expect(after.invites).toEqual([expect.objectContaining({ email: invitee, accepted: true })])

        const res = await testSend(invitee)
        expect(res.status).toBe(403)
        expect(notify).not.toHaveBeenCalled()

        await expectRegisteredStillSends()
      })
    })
  },
})
