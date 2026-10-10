'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createWorkLog } from '@/app/actions/work-logs';
import { MarkdownEditor } from './markdown-editor';
import { ReportDatePicker } from './report-date-picker';
import { WorkLogSubmissionStatus, WorkLogSubmitButton } from './work-log-submit';
import {
  clearSubmittedWorkLogDraft, readDraftImages, readWorkLogDraft, removeDraftImages,
  restoreDraftImages, workLogDraftKey, writeDraftImages, writeWorkLogDraft,
  type DraftPastedImage, type WorkLogDraft,
} from '@/lib/work-log-draft';

const errors: Record<string, string> = {
  date: '请选择今天或过去的有效日报日期。',
  'too-long': '日志内容不能超过 50,000 字符。',
  image: '图片保存失败：仅支持最多 5 张 PNG、JPEG、WebP 或 GIF，每张不超过 5 MB。',
  required: '请输入 Markdown 日志内容。',
  session: '登录已失效，请重新登录后继续编辑。草稿已保留。',
  save: '提交失败，草稿已保留，请稍后重试。',
};

function emptyDraft(reportDate: string): WorkLogDraft {
  return { version: 1, id: crypto.randomUUID(), revision: crypto.randomUUID(), markdownContent: '', reportDate, updatedAt: new Date().toISOString() };
}

export function NewWorkLogForm({ userId, today, error }: { userId: string; today: string; error?: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [initialValue, setInitialValue] = useState('');
  const [initialImages, setInitialImages] = useState<DraftPastedImage[]>([]);
  const [reportDate, setReportDate] = useState(today);
  const [editorKey, setEditorKey] = useState(0);
  const [restored, setRestored] = useState(false);
  const [status, setStatus] = useState('');
  const [storageError, setStorageError] = useState('');
  const [submissionError, setSubmissionError] = useState(error ? errors[error] ?? errors.required : '');
  const [submitting, setSubmitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const latest = useRef<WorkLogDraft | undefined>(undefined);
  const images = useRef<DraftPastedImage[]>([]);
  const imageQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingImages = useRef(0);
  const textSaved = useRef(true);
  const imagesSaved = useRef(true);
  const edited = useRef(false);
  const missingImages = useRef(false);
  const mounted = useRef(false);

  function saveSnapshot(draft: WorkLogDraft, announce = true) {
    try {
      writeWorkLogDraft(window.localStorage, userId, draft);
      textSaved.current = true;
      if (announce && mounted.current) {
        setStatus(pendingImages.current ? '正在保存草稿图片…' : imagesSaved.current && !missingImages.current ? '草稿已自动保存' : '正文草稿已自动保存');
        if (imagesSaved.current && !missingImages.current) setStorageError('');
      }
    } catch {
      textSaved.current = false;
      if (mounted.current) setStorageError('草稿未能自动保存，请先复制正文，避免离开页面后丢失内容。');
    }
  }

  function saveImages(draftId: string, pasted: DraftPastedImage[]) {
    pendingImages.current += 1;
    if (mounted.current) setStatus('正在保存草稿图片…');
    imageQueue.current = imageQueue.current.then(() => writeDraftImages(userId, draftId, pasted))
      .then(() => { imagesSaved.current = true; })
      .catch(() => {
        imagesSaved.current = false;
        if (mounted.current) setStorageError('正文草稿已保留，但图片草稿保存失败。请在离开前提交，或保留原始图片。');
      }).finally(() => {
        pendingImages.current -= 1;
        if (mounted.current && pendingImages.current === 0 && textSaved.current && imagesSaved.current && !missingImages.current) {
          setStatus('草稿已自动保存');
          setStorageError('');
        }
      });
  }

  function changeDraft(patch: Partial<Pick<WorkLogDraft, 'markdownContent' | 'reportDate'>>) {
    if (!latest.current) return;
    edited.current = true;
    latest.current = { ...latest.current, ...patch, revision: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    missingImages.current = [...latest.current.markdownContent.matchAll(/!\[[^\]]*\]\((blob:[^\s)]+)\)/g)]
      .some((match) => !images.current.some((image) => image.source === match[1]));
    saveSnapshot(latest.current);
  }

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function restore() {
      let draft = emptyDraft(today);
      let pasted: DraftPastedImage[] = [];
      let existing = false;
      try {
        const saved = readWorkLogDraft(window.localStorage, userId);
        if (saved) {
          draft = saved;
          existing = true;
          if (/!\[[^\]]*\]\(blob:/.test(saved.markdownContent)) {
            try { pasted = await readDraftImages(userId, saved.id); }
            catch { /* Keep the complete text if image storage is unavailable. */ }
            if (cancelled) return;
            const recovered = restoreDraftImages(saved.markdownContent, pasted);
            pasted = recovered.images;
            draft = { ...saved, markdownContent: recovered.markdownContent, revision: crypto.randomUUID() };
            if (recovered.missing) {
              missingImages.current = true;
              setStorageError('草稿正文已恢复，但部分图片无法恢复，请重新粘贴这些图片。');
            }
          }
        }
      } catch {
        textSaved.current = false;
        setStorageError('无法读取上次的草稿。请保留当前正文，并检查浏览器是否允许保存网站数据。');
      }
      if (cancelled) return;
      latest.current = draft;
      images.current = pasted;
      setInitialValue(draft.markdownContent);
      setInitialImages(pasted);
      setReportDate(draft.reportDate);
      setRestored(existing);
      setReady(true);
      if (existing) {
        saveSnapshot(draft);
        if (pasted.length) saveImages(draft.id, pasted);
      }
    }
    void restore();
    // Text is saved synchronously on every edit. Do not overwrite another tab's
    // newer draft just because this page was hidden or unmounted.
    const flush = () => { if (latest.current && edited.current && !textSaved.current) saveSnapshot(latest.current, false); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const beforeClose = (event: BeforeUnloadEvent) => {
      flush();
      if (!textSaved.current || !imagesSaved.current || missingImages.current || pendingImages.current > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', beforeClose);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      mounted.current = false;
      flush();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', beforeClose);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, today]);

  async function submit(formData: FormData) {
    const draft = latest.current;
    if (!draft) return;
    const submitted = { ...draft };
    saveSnapshot(submitted);
    formData.set('draftId', submitted.id);
    formData.set('markdownContent', submitted.markdownContent);
    formData.set('reportDate', submitted.reportDate);
    formData.set('pastedImageSources', JSON.stringify(images.current.map((image) => image.source)));
    formData.delete('pastedImages');
    for (const image of images.current) formData.append('pastedImages', image.file);
    setSubmitting(true);
    setSubmissionError('');
    try {
      const result = await createWorkLog(formData);
      if ('error' in result) { setSubmissionError(errors[result.error] ?? errors.save); return; }
      await imageQueue.current;
      if (latest.current?.id === submitted.id && latest.current.revision === submitted.revision) {
        latest.current = undefined;
        textSaved.current = true;
        imagesSaved.current = true;
        missingImages.current = false;
      }
      try {
        if (clearSubmittedWorkLogDraft(window.localStorage, userId, submitted)) {
          await removeDraftImages(userId, submitted.id);
        }
      } catch { /* A successful server save still takes the user to their submitted log. */ }
      router.push(result.redirectTo);
      router.refresh();
    } catch { setSubmissionError(errors.save); }
    finally { if (mounted.current) setSubmitting(false); }
  }

  async function discard() {
    if (!latest.current || !window.confirm('确定丢弃当前草稿吗？正文和未提交的粘贴图片将被清除。')) return;
    setDiscarding(true);
    const draftId = latest.current.id;
    await imageQueue.current;
    try {
      window.localStorage.removeItem(workLogDraftKey(userId));
      if (images.current.length) await removeDraftImages(userId, draftId);
      latest.current = emptyDraft(today);
      images.current = [];
      textSaved.current = true;
      imagesSaved.current = true;
      missingImages.current = false;
      edited.current = false;
      setInitialValue('');
      setInitialImages([]);
      setReportDate(today);
      setEditorKey((key) => key + 1);
      setRestored(false);
      setStatus('草稿已清空');
      setStorageError('');
      setSubmissionError('');
    } catch { setStorageError('草稿清除失败，请稍后重试。'); }
    finally { setDiscarding(false); }
  }

  return <form className="wt-panel wt-form wt-markdown-form" action={submit}>
    {!ready ? <p role="status">正在恢复草稿…</p> : <>
      {submissionError && <p className="wt-form-error" role="alert">{submissionError}</p>}
      <div className="wt-markdown-meta"><label><span>日报日期</span><ReportDatePicker defaultValue={today} maxDate={today} value={reportDate} onChange={(value) => { setReportDate(value); changeDraft({ reportDate: value }); }} /></label><p>当前文字显示 Markdown 标记，移开焦点后显示排版；标题与缩进可折叠。</p></div>
      <div className="wt-draft-status">
        <p role="status">{restored ? '已恢复上次未提交的草稿。' : '草稿会自动保存在此浏览器，重新打开后可继续编辑。'} {status}</p>
        <button type="button" className="wt-draft-discard" disabled={submitting || discarding} onClick={discard}>{discarding ? '正在清除…' : '丢弃草稿'}</button>
      </div>
      {storageError && <p className="wt-form-error" role="alert">{storageError}</p>}
      <MarkdownEditor key={editorKey} initialValue={initialValue} initialPastedImages={initialImages} onChange={(value) => changeDraft({ markdownContent: value })} onPastedImagesChange={(pasted) => {
        images.current = pasted;
        if (latest.current) saveImages(latest.current.id, pasted);
      }} />
      <WorkLogSubmissionStatus />
      <div className="wt-form-actions"><Link className="wt-secondary-button" href="/console/logs">取消</Link><WorkLogSubmitButton /></div>
    </>}
  </form>;
}
