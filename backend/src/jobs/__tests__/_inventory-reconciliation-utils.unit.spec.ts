import {
  getInventoryDriftItems,
  getLotAnomalies,
  getStaleWooConnections,
} from "../../utils/inventory-reconciliation-utils";

describe("inventory reconciliation utils", () => {
  it("detects inventory drift when reserved exceeds stocked", () => {
    const drift = getInventoryDriftItems([
      { id: "inv_1", stocked_quantity: 10, reserved_quantity: 3 },
      { id: "inv_2", stocked_quantity: 5, reserved_quantity: 7 },
      { id: "inv_3", stocked_quantity: 0, reserved_quantity: 0 },
    ]);

    expect(drift.map((i) => i.id)).toEqual(["inv_2"]);
  });

  it("detects lots with negative quantities", () => {
    const anomalies = getLotAnomalies([
      { id: "lot_1", quantity_available: 10, quantity_reserved: 1 },
      { id: "lot_2", quantity_available: -1, quantity_reserved: 0 },
      { id: "lot_3", quantity_available: 2, quantity_reserved: -3 },
    ]);

    expect(anomalies.map((l) => l.id)).toEqual(["lot_2", "lot_3"]);
  });

  it("flags stale woo connections", () => {
    const now = new Date("2026-02-15T00:00:00.000Z").getTime();
    const twoDaysMs = 1000 * 60 * 60 * 48;

    const stale = getStaleWooConnections(
      [
        { id: "woo_1", last_synced_at: "2026-02-14T10:00:00.000Z" },
        { id: "woo_2", last_synced_at: "2026-02-10T10:00:00.000Z" },
        { id: "woo_3", last_synced_at: null },
        { id: "woo_4", last_synced_at: "invalid-date" },
      ],
      now,
      twoDaysMs,
    );

    expect(stale.map((c) => c.id)).toEqual(["woo_2", "woo_3", "woo_4"]);
  });
});
