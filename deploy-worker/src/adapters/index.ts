import { StaticAdapter } from "./static.js";
import { Pm2Adapter } from "./pm2.js";
import { SystemdAdapter } from "./systemd.js";
import { ComposeAdapter } from "./compose.js";

export const adapters = {
  static: new StaticAdapter(),
  pm2: new Pm2Adapter(),
  systemd: new SystemdAdapter(),
  compose: new ComposeAdapter()
} as const;

export function getAdapter(name: keyof typeof adapters) {
  return adapters[name];
}
