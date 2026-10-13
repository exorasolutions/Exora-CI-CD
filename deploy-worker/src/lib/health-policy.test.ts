import assert from "node:assert/strict";
import test from "node:test";
import { validateLiveHealthPolicy } from "./health-policy.js";

test("requires a health URL", () => {
  assert.throws(
    () => validateLiveHealthPolicy({ id: "exora-production", adapter: "exora-production" }),
    /requires a configured health URL/
  );
});

test("allows only the configured Exora MERN health URL", () => {
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
});

test("allows only the configured Exora static health URL", () => {
  assert.doesNotThrow(() => validateLiveHealthPolicy({
    id: "exora-static",
    adapter: "exora-static",
    healthUrl: "http://127.0.0.1:8110/",
    healthExpectedStatus: 200
  }));

  assert.throws(() => validateLiveHealthPolicy({
    id: "exora-static",
    adapter: "exora-static",
    healthUrl: "https://example.com/"
  }), /unsupported Exora static health URL/);

  assert.throws(() => validateLiveHealthPolicy({
    id: "exora-static",
    adapter: "exora-production",
    healthUrl: "http://127.0.0.1:8110/"
  }), /must match/);
});
