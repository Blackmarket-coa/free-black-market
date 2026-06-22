import { createHmac } from "crypto";
import {
  isDeployCallbackConfigured,
  isProvisioningStale,
  normalizeDomains,
  PROVISIONING_TIMEOUT_MS,
  verifyDeploySignature,
} from "../site-provisioning";

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("site-provisioning deploy callback verification", () => {
  const ORIGINAL = process.env.SITE_DEPLOY_SECRET;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.SITE_DEPLOY_SECRET;
    } else {
      process.env.SITE_DEPLOY_SECRET = ORIGINAL;
    }
  });

  it("isDeployCallbackConfigured reflects the env var", () => {
    delete process.env.SITE_DEPLOY_SECRET;
    expect(isDeployCallbackConfigured()).toBe(false);
    process.env.SITE_DEPLOY_SECRET = "s3cret";
    expect(isDeployCallbackConfigured()).toBe(true);
  });

  it("accepts a correct signature (string and Buffer bodies)", () => {
    process.env.SITE_DEPLOY_SECRET = "s3cret";
    const body = JSON.stringify({ repo: "org/site-x", status: "live" });
    const sig = sign(body, "s3cret");
    expect(verifyDeploySignature(body, sig)).toBe(true);
    expect(verifyDeploySignature(Buffer.from(body), sig)).toBe(true);
  });

  it("rejects a wrong or malformed signature", () => {
    process.env.SITE_DEPLOY_SECRET = "s3cret";
    const body = JSON.stringify({ repo: "org/site-x" });
    expect(verifyDeploySignature(body, sign(body, "different-secret"))).toBe(
      false,
    );
    expect(verifyDeploySignature(body, "deadbeef")).toBe(false);
  });

  it("rejects when the secret or signature is missing", () => {
    process.env.SITE_DEPLOY_SECRET = "s3cret";
    expect(verifyDeploySignature("{}", "")).toBe(false);
    delete process.env.SITE_DEPLOY_SECRET;
    expect(verifyDeploySignature("{}", "abc123")).toBe(false);
  });
});

describe("isProvisioningStale (launch timeout)", () => {
  const now = 1_000_000_000_000;

  it("is false for missing/unparseable timestamps", () => {
    expect(isProvisioningStale(null, now)).toBe(false);
    expect(isProvisioningStale(undefined, now)).toBe(false);
    expect(isProvisioningStale("not-a-date", now)).toBe(false);
  });

  it("is false within the timeout window", () => {
    const recent = now - (PROVISIONING_TIMEOUT_MS - 1000);
    expect(isProvisioningStale(new Date(recent), now)).toBe(false);
    expect(isProvisioningStale(new Date(recent).toISOString(), now)).toBe(false);
  });

  it("is true once past the timeout window", () => {
    const old = now - (PROVISIONING_TIMEOUT_MS + 1000);
    expect(isProvisioningStale(new Date(old), now)).toBe(true);
    expect(isProvisioningStale(new Date(old).toISOString(), now)).toBe(true);
    expect(isProvisioningStale(old, now)).toBe(true);
  });
});

describe("normalizeDomains (Connect whitelist)", () => {
  it("strips protocol, path, query, and www; lowercases; dedupes", () => {
    expect(
      normalizeDomains([
        "https://www.Example.com/shop?ref=1",
        "example.com",
        "  SHOP.example.com  ",
      ]),
    ).toEqual(["example.com", "shop.example.com"]);
  });

  it("drops non-strings and implausible hostnames", () => {
    expect(normalizeDomains(["localhost", "no-tld", 42, null, ""])).toEqual([]);
  });

  it("returns [] for non-array input and caps the list at 50", () => {
    expect(normalizeDomains("example.com")).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => `site${i}.com`);
    expect(normalizeDomains(many)).toHaveLength(50);
  });
});
