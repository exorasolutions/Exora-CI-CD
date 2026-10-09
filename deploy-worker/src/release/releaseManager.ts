import fs from "node:fs/promises";
import path from "node:path";
import { safeReleasePath } from "./pathSafety.js";

export class ReleaseManager {
  constructor(private readonly root: string) {}

  async prepare(releaseId: string) {
    const releasePath = safeReleasePath(this.root, releaseId);
    await fs.mkdir(releasePath, { recursive: true });
    return releasePath;
  }

  async activate(releaseId: string) {
    const releasePath = safeReleasePath(this.root, releaseId);
    await fs.access(releasePath);
    const current = path.resolve(this.root, "current");
    const tmp = path.resolve(this.root, `.current-${releaseId}-tmp`);
    await fs.rm(tmp, { force: true });
    await fs.symlink(releasePath, tmp, "dir");
    await fs.rename(tmp, current);
  }

  async current(): Promise<string | null> {
    try {
      return path.basename(await fs.readlink(path.resolve(this.root, "current")));
    } catch {
      return null;
    }
  }

  async previous(currentId: string | null): Promise<string | null> {
    const dir = path.resolve(this.root, "releases");
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter(e => e.isDirectory() && e.name !== currentId)
      .map(e => e.name)
      .sort()
      .reverse()[0] ?? null;
  }
}
