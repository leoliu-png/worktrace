import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());

describe('production deployment configuration', () => {
  it('keeps WorkTrace private behind Caddy on localhost port 16063', () => {
    const compose = readFileSync(resolve(root, 'compose.yaml'), 'utf8');

    expect(compose).toContain('127.0.0.1:16063:3000');
    expect(compose).toContain('worktrace_data:/var/lib/worktrace');
    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toContain('TZ: Asia/Shanghai');
  });

  it('excludes local secrets and test data from Docker build context', () => {
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');

    expect(dockerignore).toContain('.env');
    expect(dockerignore).toContain('*.db');
    expect(dockerignore).toContain('uploads');
    expect(dockerignore).toContain('.private');
  });

  it('pins Auth.js to the public production origin', () => {
    const environment = readFileSync(resolve(root, 'deploy', 'worktrace.env.example'), 'utf8');

    expect(environment).toContain('AUTH_URL=https://worktrace.techmob.net');
  });
});
