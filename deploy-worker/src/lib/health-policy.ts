export type HealthTarget = {
  id: string;
  adapter: string;
  healthUrl?: string;
  healthExpectedStatus?: number;
};

const EXORA_MERN_HEALTH_URL = "http://127.0.0.1:5555/health";
const EXORA_STATIC_HEALTH_URL = "http://127.0.0.1:8110/";

export function validateLiveHealthPolicy(target: HealthTarget): void {
  if (!target.healthUrl?.trim()) {
    throw new Error("live deployment requires a configured health URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(target.healthUrl);
  } catch {
    throw new Error(`invalid health URL: ${target.healthUrl}`);
  }

  if (target.id === "exora-static" || target.adapter === "exora-static") {
    if (target.id !== "exora-static" || target.adapter !== "exora-static") {
      throw new Error("Exora static target and adapter must match");
    }
    if (parsed.href !== EXORA_STATIC_HEALTH_URL) {
      throw new Error(`unsupported Exora static health URL: ${target.healthUrl}`);
    }
    if ((target.healthExpectedStatus ?? 200) !== 200) {
      throw new Error("unsupported Exora static health expected status");
    }
    return;
  }

  if (target.id === "exora-production" || target.adapter === "exora-production") {
    if (parsed.href !== EXORA_MERN_HEALTH_URL) {
      throw new Error(`unsupported Exora health URL: ${target.healthUrl}`);
    }
    if ((target.healthExpectedStatus ?? 200) !== 200) {
      throw new Error(`unsupported Exora health expected status: ${target.healthExpectedStatus}`);
    }
  }
}
