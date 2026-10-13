import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from './project-registry.js';
import { selectJenkinsJob } from './jenkins-client.js';

const baseProject = {
  id: 'test-project',
  enabled: true,
  github: { owner: 'example', repo: 'test', branch: 'main' },
  build: {
    profile: 'node-npm-v1',
    agentLabel: 'linux-build',
    testsRequired: true,
    timeoutMinutes: 30
  },
  deployment: {
    mode: 'manual',
    adapter: 'pm2',
    targetId: 'test-target',
    environment: 'production'
  }
} satisfies Omit<Project, 'jenkinsJob'>;

test('uses the project-specific Jenkins job when configured', () => {
  const project = { ...baseProject, jenkinsJob: 'deploy-test-project' } as Project;
  assert.equal(selectJenkinsJob(project, 'central-cicd-build'), 'deploy-test-project');
});

test('falls back to the legacy Jenkins job when no override is configured', () => {
  assert.equal(selectJenkinsJob(baseProject as Project, 'central-cicd-build'), 'central-cicd-build');
});
