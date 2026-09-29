import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiKeyRevealEndpoint } from './api-key-reveal';

describe('API key reveal requests', () => {
  it('targets only the selected API key', () => {
    expect(apiKeyRevealEndpoint('key-123')).toBe('/api/v1/api-keys/key-123/reveal');
  });

  it('disables the selected reveal button while its secret is being read', () => {
    const component = readFileSync(resolve(process.cwd(), 'src/components/reveal-key-button.tsx'), 'utf8');

    expect(component).toContain("const [isRevealing, setIsRevealing] = useState(false);");
    expect(component).toContain("disabled={isRevealing}");
    expect(component).toContain("isRevealing ? '读取中…'");
  });
});
