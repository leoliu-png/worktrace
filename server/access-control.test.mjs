import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessAdmin, navigationFor } from './access-control.mjs';

test('member navigation does not expose any administrative pages', () => {
  const items = navigationFor('member').map((item) => item.id);
  assert.equal(canAccessAdmin('member'), false);
  assert.deepEqual(items, ['overview', 'logs', 'new-log', 'api-keys', 'my-logs']);
});

test('administrator navigation includes all administrative pages', () => {
  const items = navigationFor('admin').map((item) => item.id);
  assert.equal(canAccessAdmin('admin'), true);
  assert.deepEqual(items.slice(-4), ['members', 'access', 'admin-logs', 'audit']);
});
