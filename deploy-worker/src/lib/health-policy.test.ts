import assert from "node:assert/strict";
import test from "node:test";
import { validateLiveHealthPolicy } from "./health-policy.js";

test("requires a health URL for live deployments", () => {
  assert.throws(() => validateLiveHealthPolicy({
    id: "exora-production",
    adapter: "exora-production"
  }), /requires a configured health URL/);
});

test("allows only the intended Exora local health endpoint", () => {
  assert.doesNotThrow(() => validateLiveHealthPolicy({
    id: "exora-production",
    adapter: "exora-production",
    healthUrl: "http://127.0.0.1:5555/health",
    healthExpectedStatus: 200
  }));

  assert.throws(() => validateLiveHealthPolicy({
    id: "exora-production",
    adapter: "exora-production",
    healthUrl: "https://example.com/health"
  }), /unsupported Exora health URL/);

  assert.throws(() => validateLiveHealthPolicy({
    id: "exora-production",
    adapter: "exora-production",
    healthUrl: "not a url"
  }), /invalid health URL/);

  assert.throws(() => validateLiveHealthPolicy({
    id: "exora-production",
    adapter: "exora-production",
    healthUrl: "http://127.0.0.1:5555/health",
    healthExpectedStatus: 204
  }), /unsupported Exora health expected status/);
});
