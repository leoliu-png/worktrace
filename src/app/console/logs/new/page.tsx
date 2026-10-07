import Link from 'next/link';
import { createWorkLog } from '@/app/actions/work-logs';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { MarkdownEditor } from '@/components/markdown-editor';
import { ReportDatePicker } from '@/components/report-date-picker';
import { WorkLogSubmissionStatus, WorkLogSubmitButton } from '@/components/work-log-submit';
import { workTraceReportDate } from '@/lib/report-date';

type PageProps = { searchParams: Promise<{ error?: string }> };

export default async function NewLogPage({ searchParams }: PageProps) {
  const today = workTraceReportDate();
  const error = (await searchParams).error;
  return <ConsolePageFrame title="新建日志" activePath="/console/logs/new">
    <p className="wt-description">提交后将立即对团队成员可见。</p>
    <form className="wt-panel wt-form wt-markdown-form" action={createWorkLog}>
      {error && <p className="wt-form-error">{error === 'date' ? '请选择今天或过去的有效日报日期。' : error === 'too-long' ? '日志内容不能超过 50,000 字符。' : error === 'image' ? '图片保存失败：仅支持最多 5 张 PNG、JPEG、WebP 或 GIF，每张不超过 5 MB。' : '请输入 Markdown 日志内容。'}</p>}
      <div className="wt-markdown-meta"><label><span>日报日期</span><ReportDatePicker defaultValue={today} maxDate={today} /></label><p>当前文字显示 Markdown 标记，移开焦点后显示排版；标题与缩进可折叠。</p></div>
      <MarkdownEditor />
      <WorkLogSubmissionStatus />
      <div className="wt-form-actions"><Link className="wt-secondary-button" href="/console/logs">取消</Link><WorkLogSubmitButton /></div>
    </form>
  </ConsolePageFrame>;
}
