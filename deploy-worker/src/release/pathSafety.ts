import path from "node:path";

export function safeReleasePath(root: string, releaseId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(releaseId)) throw new Error("invalid release id");
  const base = path.resolve(root);
  const resolved = path.resolve(base, "releases", releaseId);
  if (!resolved.startsWith(base + path.sep)) throw new Error("release path escapes target");
  return resolved;
}

export function assertSafeArchiveEntry(name: string) {
  const n = path.posix.normalize(name.replaceAll("\\", "/"));
  if (n === ".." || n.startsWith("../") || n.startsWith("/") || /^[A-Za-z]:/.test(n)) {
    throw new Error(`unsafe archive entry: ${name}`);
  }
}
