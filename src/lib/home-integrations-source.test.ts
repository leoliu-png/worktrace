import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('home integration guide source', () => {
  it('presents Skill and MCP as a static dual-track access workspace', () => {
    const component = source('src/components/home-integrations.tsx');
    const page = source('src/app/page.tsx');
    const styles = source('src/app/styles.css');

    expect(page).toContain('className="stitch-home-route"');
    expect(component).toContain('className="wt-access-rail"');
    expect(component).toContain('className="wt-access-track wt-access-track-skill"');
    expect(component).toContain('className="wt-access-track wt-access-track-mcp"');
    expect(component).toContain('className="wt-access-stages"');
    expect(component).not.toContain('const [open');
    expect(styles).toContain('.stitch-home-route {');
    expect(styles).toContain('.wt-access-rail {');
    expect(styles).toContain('.wt-access-track-skill {');
    expect(styles).toContain('.wt-access-track-mcp {');
  });

  it('restores the original one-screen desktop access desk', () => {
    const styles = source('src/app/styles.css');

    expect(styles).toContain('@media (min-width:1100px) and (min-height:760px)');
    expect(styles).toContain('.stitch-home { min-height:100svh; height:100svh; overflow:hidden; }');
    expect(styles).toContain('.wt-access-track { min-height:0; padding:28px; overflow:auto; }');
  });

  it('places the MCP track beside the access introduction and the Skill track below it', () => {
    const styles = source('src/app/styles.css');

    expect(styles).toContain('.wt-home-integrations { display:grid; grid-template-columns:minmax(0,1.14fr) minmax(0,.86fr);');
    expect(styles).toContain('.wt-access-track-skill { grid-column:1; grid-row:2; }');
    expect(styles).toContain('.wt-access-track-mcp { grid-column:2; grid-row:1 / span 2; }');
  });
});
