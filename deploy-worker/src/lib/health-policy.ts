export type HealthTarget = {
  id: string;
  adapter: string;
  healthUrl?: string;
  healthExpectedStatus?: number;
};

const EXORA_HEALTH_URL = "http://127.0.0.1:5555/health";

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

  if (target.id === "exora-production" || target.adapter === "exora-production") {
    if (parsed.href !== EXORA_HEALTH_URL) {
      throw new Error(`unsupported Exora health URL: ${target.healthUrl}`);
    }
    if ((target.healthExpectedStatus ?? 200) !== 200) {
      throw new Error(`unsupported Exora health expected status: ${target.healthExpectedStatus}`);
    }
  }
}
