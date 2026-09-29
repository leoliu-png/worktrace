import { describe, expect, it } from 'vitest';
import { homeLoginDestination } from './home-login';

describe('home login destination', () => {
  it('sends an existing signed-in user directly to the console', () => {
    expect(homeLoginDestination(true)).toBe('/console');
  });

  it('keeps Google sign-in for a visitor without a session', () => {
    expect(homeLoginDestination(false)).toBeUndefined();
  });
});
