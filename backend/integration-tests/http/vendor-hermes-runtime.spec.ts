import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

jest.setTimeout(120 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    describe("Vendor Hermes runtime endpoint", () => {
      it("requires seller authentication", async () => {
        const response = await api
          .post("/vendor/hermes/runtime", {
            tool_call: {
              action: "create_product",
              parameters: {
                title: "Draft",
                description: "Draft",
                price: 10,
                currency_code: "usd",
              },
            },
          })
          .catch((e) => e.response);

        expect(response.status).toBe(401);
      });
    });
  },
});
