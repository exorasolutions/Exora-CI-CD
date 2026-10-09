import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { branchFromRef, verifyGitHubSignature } from './github.js';

test('verifies GitHub sha256 signature', () => {
  const secret = 'this-is-a-long-test-secret';
  const body = Buffer.from('{"ok":true}');
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyGitHubSignature(body, signature, secret), true);
  assert.equal(verifyGitHubSignature(body, 'sha256=' + '0'.repeat(64), secret), false);
});

test('extracts branch name', () => {
  assert.equal(branchFromRef('refs/heads/main'), 'main');
  assert.equal(branchFromRef('refs/tags/v1'), null);
});
