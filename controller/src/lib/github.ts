import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export function verifyGitHubSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const PushPayload = z.object({
  ref: z.string(),
  after: z.string().regex(/^[0-9a-f]{40}$/i),
  deleted: z.boolean().optional().default(false),
  repository: z.object({
    id: z.number().int().positive(),
    full_name: z.string().min(3),
    clone_url: z.string().url(),
    html_url: z.string().url()
  }),
  pusher: z.object({ name: z.string().optional() }).optional(),
  head_commit: z.object({ message: z.string().optional() }).nullable().optional()
});

export type GitHubPush = z.infer<typeof PushPayload>;
export function parsePush(payload: unknown): GitHubPush { return PushPayload.parse(payload); }
export function branchFromRef(ref: string) { return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null; }
