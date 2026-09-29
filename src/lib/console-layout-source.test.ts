import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('console layout source', () => {
  it('keeps a homepage link in the console top bar', () => {
    const shell = source('src/components/console-shell.tsx');

    expect(shell).toContain('className="console-home-link"');
    expect(shell).toContain('href="/"');
  });

  it('allows work-log forms and details to fill the console content width', () => {
    const styles = source('src/app/styles.css');

    expect(styles).toContain('.wt-form { width:100%; max-width:none; }');
    expect(styles).toContain('.wt-log-detail { width:100%; max-width:none; }');
  });

  it('uses the homepage mist background across the console shell and loading layer', () => {
    const styles = source('src/app/styles.css');

    expect(styles).toContain('.stitch-console,.stitch-console-main,.stitch-console-content { background:#f4f7f8; }');
    expect(styles).toContain('.console-topbar,.stitch-mobile-nav { background:#f4f7f8; border-color:#d6e0e2; }');
    expect(styles).toContain('.wt-content-loading { background:#f4f7f8; }');
  });

  it('does not expose the legacy white page surface around the console', () => {
    const styles = source('src/app/styles.css');

    expect(styles).toContain('html,body { background:#f4f7f8; }');
    expect(styles).toContain('.stitch-runtime-shell,.stitch-prototype-frame { background:#f4f7f8; }');
  });

  it('uses the homepage teal palette for console navigation and primary actions', () => {
    const styles = source('src/app/styles.css');

    expect(styles).toContain('.stitch-console .stitch-sidebar-brand,.stitch-console .stitch-sidebar-brand h1 { color:#0b6f82; }');
    expect(styles).toContain('.stitch-console .stitch-new-log,.stitch-console .wt-primary-button { background:#0d7581; color:#fff; }');
    expect(styles).toContain('.stitch-console .stitch-sidebar nav a.active { background:#dff1ed; border-left-color:#0d7581; color:#0b6f82; }');
  });

  it('keeps the console brand link on the same teal as the homepage wordmark', () => {
    const styles = source('src/app/styles.css');

    expect(styles).toContain('.stitch-console .stitch-sidebar > a.stitch-sidebar-brand { color:#0b6f82; }');
  });
});
