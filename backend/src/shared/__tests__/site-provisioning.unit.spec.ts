import { createHmac } from "crypto";
import {
  isDeployCallbackConfigured,
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
