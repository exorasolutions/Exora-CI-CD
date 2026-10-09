import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) hash.update(chunk as Buffer);
  } finally { await handle.close(); }
  return hash.digest('hex');
}

export function assertInside(file: string, allowedRoot: string): string {
  const resolvedFile = path.resolve(file);
  const resolvedRoot = path.resolve(allowedRoot) + path.sep;
  if (!resolvedFile.startsWith(resolvedRoot)) throw new Error('Artifact path is outside allowed staging root');
  return resolvedFile;
}
