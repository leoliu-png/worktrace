import { ConsolePageFrame } from '@/components/console-page-frame';

export default function AccessPage() {
  return <ConsolePageFrame title="权限控制" activePath="/console/admin/access" administratorOnly>
    <p className="wt-description">仅允许 Google Workspace 企业域名访问 WorkTrace。</p>
    <section className="wt-panel"><h2>允许域名</h2><div className="wt-access-domain"><div><strong>feedmob.com</strong><p>Google OAuth 登录域名白名单</p></div><span className="wt-status">已启用</span></div><p className="wt-description">首版已为多域名配置保留数据模型，但默认仅允许 feedmob.com。</p></section>
  </ConsolePageFrame>;
}
