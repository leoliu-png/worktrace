'use client';

import { useState } from 'react';

type Props = { baseUrl: string; locale: 'zh' | 'en' };

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="wt-copy-button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>{copied ? '已复制' : '复制'}</button>;
}

export function HomeIntegrations({ baseUrl }: Props) {
  const skillUrl = `${baseUrl}/skill/worktrace`;
  const mcp = JSON.stringify({ mcpServers: { worktrace: { type: 'http', url: `${baseUrl}/mcp`, headers: { Authorization: 'Bearer ${WORKTRACE_API_KEY}' } } } }, null, 2);
  const skillPrompt = `请安装并使用 WorkTrace Skill：${skillUrl}\n将 API Key 安全保存为 WORKTRACE_API_KEY。先总结日志草稿并征求确认，再上传。`;

  return <section className="wt-home-integrations" aria-label="接入方式">
    <header className="wt-access-intro"><span>AGENT ACCESS DESK</span><h2>选择你的接入轨道</h2><p>两种方式都使用个人 API Key，日志会进入同一个 WorkTrace 团队空间。</p></header>
    <div className="wt-access-rail">
      <section className="wt-access-track wt-access-track-skill">
        <div className="wt-access-track-heading"><span>01 · SKILL</span><h2>安装 Skill</h2><p>适合已经支持 Skill 的 AI Agent。把下面的提示发给 Agent，它会先整理草稿、征求确认，再上传日志。</p></div>
        <div className="wt-access-code wt-access-url"><span>Skill 地址</span><div><code>{skillUrl}</code><CopyButton value={skillUrl} /></div></div>
        <ol className="wt-access-stages"><li><b>读取</b><span>日志能力说明</span></li><li><b>保存</b><span>个人 API Key</span></li><li><b>确认</b><span>再提交日志</span></li></ol>
        <div className="wt-access-prompt"><pre>{skillPrompt}</pre><CopyButton value={skillPrompt} /></div>
      </section>
      <section className="wt-access-track wt-access-track-mcp">
        <div className="wt-access-track-heading"><span>02 · MCP</span><h2>配置 MCP</h2><p>适合需要查询、汇总、创建和更新日志的 AI Agent。将 API Key 保存为 <code>WORKTRACE_API_KEY</code> 后复制配置。</p></div>
        <div className="wt-access-code wt-access-mcp-code"><pre>{mcp}</pre><CopyButton value={mcp} /></div>
        <small>可整理草稿、创建与更新日志、查询团队日志、读取单篇日志，并查询当天成员提交状态。</small>
      </section>
    </div>
  </section>;
}
