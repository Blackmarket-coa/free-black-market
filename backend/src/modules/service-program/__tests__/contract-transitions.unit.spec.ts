import {
  contractRole,
  evaluateContractTransition,
  CONTRACT_TRANSITIONS,
  type ServiceContractTransition,
} from "../contract-transitions"
import { ServiceContractStatus } from "../models/service-contract"

const PROVIDER = "provider_1"
const CLIENT = "client_1"

const contract = (status: string) => ({
  id: "contract_1",
  status,
  service_seller_id: PROVIDER,
  vendor_id: CLIENT,
})

describe("contractRole", () => {
  it("identifies provider, client, and non-party", () => {
    expect(contractRole(contract(ServiceContractStatus.ACTIVE), PROVIDER)).toBe("provider")
    expect(contractRole(contract(ServiceContractStatus.ACTIVE), CLIENT)).toBe("client")
    expect(contractRole(contract(ServiceContractStatus.ACTIVE), "stranger")).toBeNull()
    expect(contractRole(contract(ServiceContractStatus.ACTIVE), "")).toBeNull()
  })
})

describe("evaluateContractTransition", () => {
  it("rejects when the contract is missing", () => {
    expect(
      evaluateContractTransition({ contract: null, actorSellerId: PROVIDER, transition: "start" })
    ).toMatchObject({ ok: false, code: "not_found" })
  })

  it("rejects a non-participant", () => {
    expect(
      evaluateContractTransition({
        contract: contract(ServiceContractStatus.ACTIVE),
        actorSellerId: "stranger",
        transition: "start",
      })
    ).toMatchObject({ ok: false, code: "not_participant" })
  })

  describe("happy paths", () => {
    const cases: Array<[ServiceContractTransition, string, string, ServiceContractStatus]> = [
      ["start", ServiceContractStatus.ACTIVE, PROVIDER, ServiceContractStatus.IN_PROGRESS],
      ["deliver", ServiceContractStatus.ACTIVE, PROVIDER, ServiceContractStatus.DELIVERED],
      ["deliver", ServiceContractStatus.IN_PROGRESS, PROVIDER, ServiceContractStatus.DELIVERED],
      ["accept", ServiceContractStatus.DELIVERED, CLIENT, ServiceContractStatus.ACCEPTED],
      ["dispute", ServiceContractStatus.DELIVERED, PROVIDER, ServiceContractStatus.DISPUTED],
      ["dispute", ServiceContractStatus.IN_PROGRESS, CLIENT, ServiceContractStatus.DISPUTED],
      ["cancel", ServiceContractStatus.ACTIVE, CLIENT, ServiceContractStatus.CANCELED],
    ]
    it.each(cases)("%s from %s by the right party → ok", (transition, status, actor, to) => {
      const r = evaluateContractTransition({ contract: contract(status), actorSellerId: actor, transition })
      expect(r).toMatchObject({ ok: true, to })
    })
  })

  describe("role enforcement", () => {
    it("client cannot start or deliver", () => {
      expect(
        evaluateContractTransition({ contract: contract(ServiceContractStatus.ACTIVE), actorSellerId: CLIENT, transition: "start" })
      ).toMatchObject({ ok: false, code: "forbidden_role" })
      expect(
        evaluateContractTransition({ contract: contract(ServiceContractStatus.ACTIVE), actorSellerId: CLIENT, transition: "deliver" })
      ).toMatchObject({ ok: false, code: "forbidden_role" })
    })

    it("provider cannot accept or cancel", () => {
      expect(
        evaluateContractTransition({ contract: contract(ServiceContractStatus.DELIVERED), actorSellerId: PROVIDER, transition: "accept" })
      ).toMatchObject({ ok: false, code: "forbidden_role" })
      expect(
        evaluateContractTransition({ contract: contract(ServiceContractStatus.ACTIVE), actorSellerId: PROVIDER, transition: "cancel" })
      ).toMatchObject({ ok: false, code: "forbidden_role" })
    })

    it("either party can dispute", () => {
      for (const actor of [PROVIDER, CLIENT]) {
        expect(
          evaluateContractTransition({ contract: contract(ServiceContractStatus.ACTIVE), actorSellerId: actor, transition: "dispute" })
        ).toMatchObject({ ok: true })
      }
    })
  })

  describe("state enforcement", () => {
    it("cannot accept a contract that isn't delivered", () => {
      expect(
        evaluateContractTransition({ contract: contract(ServiceContractStatus.ACTIVE), actorSellerId: CLIENT, transition: "accept" })
      ).toMatchObject({ ok: false, code: "invalid_state" })
    })

    it("cannot transition terminal contracts", () => {
      for (const transition of Object.keys(CONTRACT_TRANSITIONS) as ServiceContractTransition[]) {
        const rule = CONTRACT_TRANSITIONS[transition]
        const actor = rule.role === "client" ? CLIENT : PROVIDER
        for (const terminal of [ServiceContractStatus.ACCEPTED, ServiceContractStatus.CANCELED]) {
          expect(
            evaluateContractTransition({ contract: contract(terminal), actorSellerId: actor, transition })
          ).toMatchObject({ ok: false, code: "invalid_state" })
        }
      }
    })
  })
})
