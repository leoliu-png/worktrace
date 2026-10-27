'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parser } from '@lezer/markdown';
import { Compartment, EditorState, StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { LogEditorLinks } from '@/app/console/logs/log-editor-links';
import { MarkdownEditor } from '@/components/markdown-editor';
import { WorkLogSubmissionStatus, WorkLogSubmitButton } from '@/components/work-log-submit';
import { readDraftImages, removeDraftImages, writeDraftImages, type DraftPastedImage } from '@/lib/work-log-draft';

type Origin = 'my' | 'all' | 'admin';
type Draft = {
  version: 1;
  id: string;
  logId: string;
  from: Origin;
  revision: string;
  markdownContent: string;
  imageSources: string[];
  // Old addresses still present in literal text or temporarily invalid Markdown.
  imageAliases?: Record<string, string>;
};
type Snapshot = { draft: Draft; images: DraftPastedImage[] };
export type EditLogSaveResult = { saved: boolean; redirectTo?: string };

// Files remain available during module navigation even if browser storage is disabled.
// Entries are always scoped to the user supplied by the existing server page.
const snapshots = new Map<string, Snapshot | null>();
const activeEdits = new Map<string, string | null>();
const imageWrites = new Map<string, Promise<void>>();
const draftKey = (userId: string, logId: string) =>
  `worktrace:edit-log-draft:v1:${encodeURIComponent(userId)}:${encodeURIComponent(logId)}`;
const activeKey = (userId: string) => `worktrace:active-edit-log:v1:${encodeURIComponent(userId)}`;
const imageId = (draft: Draft) => `edit-log:${draft.id}`;

function readSnapshot(userId: string, logId: string): Snapshot | undefined {
  const key = draftKey(userId, logId);
  if (snapshots.has(key)) return snapshots.get(key) ?? undefined;
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid edit draft');
  const draft = value as Partial<Draft>;
  if (draft.version !== 1 || draft.logId !== logId || typeof draft.id !== 'string' || !draft.id ||
      typeof draft.revision !== 'string' || !draft.revision || typeof draft.markdownContent !== 'string' ||
      !Array.isArray(draft.imageSources) || !draft.imageSources.every((source) => typeof source === 'string') ||
      (draft.imageAliases !== undefined && (!draft.imageAliases || typeof draft.imageAliases !== 'object' ||
        Array.isArray(draft.imageAliases) || !Object.values(draft.imageAliases).every((source) => typeof source === 'string'))) ||
      !['my', 'all', 'admin'].includes(draft.from ?? '')) throw new Error('Invalid edit draft');
  return { draft: draft as Draft, images: [] };
}

function readActive(userId: string) {
  if (activeEdits.has(userId)) return activeEdits.get(userId);
  return window.localStorage.getItem(activeKey(userId));
}

function queueImages(userId: string, draft: Draft, images: DraftPastedImage[]) {
  const key = `${draftKey(userId, draft.logId)}:${draft.id}`;
  const pending = (imageWrites.get(key) ?? Promise.resolve()).catch(() => undefined)
    .then(() => writeDraftImages(userId, imageId(draft), images));
  imageWrites.set(key, pending);
  void pending.finally(() => {
    if (imageWrites.get(key) === pending) imageWrites.delete(key);
  }).catch(() => undefined);
  return pending;
}

function clearSnapshot(userId: string, submitted: Draft) {
  const key = draftKey(userId, submitted.logId);
  const current = snapshots.get(key);
  // A save finishing later must not discard newer edits or a new editing session.
  if (!current || current.draft.id !== submitted.id || current.draft.revision !== submitted.revision) return;
  snapshots.set(key, null);
  let failed = false;
  try { window.localStorage.removeItem(key); } catch { failed = true; }
  try {
    if (readActive(userId) === submitted.logId) {
      activeEdits.set(userId, null);
      window.localStorage.removeItem(activeKey(userId));
    }
  } catch {
    activeEdits.set(userId, null);
    failed = true;
  }
  const imageKey = `${key}:${submitted.id}`;
  void (imageWrites.get(imageKey) ?? Promise.resolve()).catch(() => undefined)
    .then(() => removeDraftImages(userId, imageId(submitted))).catch(() => undefined);
  return failed;
}

type ImageDestination = { from: number; to: number; source: string };

// Parse the complete document so nested fences, inline code, escaped syntax,
// Unicode labels and punctuation keep their original meaning and offsets.
function imageDestinations(markdownContent: string, sources: Set<string>) {
  const destinations = new Map<number, ImageDestination>();
  parser.parse(markdownContent).iterate({ enter(node) {
    if (node.name !== 'URL') return;
    const raw = markdownContent.slice(node.from, node.to);
    const wrapped = raw.startsWith('<') && raw.endsWith('>');
    const source = wrapped ? raw.slice(1, -1) : raw;
    if (sources.has(source)) {
      const from = node.from + (wrapped ? 1 : 0);
      destinations.set(from, { from, to: from + source.length, source });
    }
  } });

  // A destination being edited may not have a URL node yet. Probe a closing
  // delimiter without changing the actual document, then require the Markdown
  // parser to identify that exact destination in a link or image. A plain
  // replaceAll would also corrupt literal examples and longer URL tokens.
  for (const source of sources) {
    if (!source) continue;
    let offset = markdownContent.indexOf(source);
    while (offset !== -1) {
      const from = offset;
      const to = from + source.length;
      offset = markdownContent.indexOf(source, to);
      if (destinations.has(from) || !/\]\([ \t\r\n]*<?$/.test(markdownContent.slice(0, from))) continue;
      const wrapped = markdownContent[from - 1] === '<';
      const following = markdownContent[to];
      if (following !== undefined && !/[ \t\r\n)]/.test(following) && !(wrapped && following === '>')) continue;
      const insertAt = to + (wrapped && following === '>' ? 1 : 0);
      const closing = wrapped && following !== '>' ? '>)' : ')';
      const probe = markdownContent.slice(0, insertAt) + closing + markdownContent.slice(insertAt);
      parser.parse(probe).iterate({ enter(node) {
        if (node.name !== 'URL' || !['Image', 'Link'].includes(node.node.parent?.name ?? '')) return;
        if (node.from === from - (wrapped ? 1 : 0) && node.to === to + (wrapped ? 1 : 0)) {
          destinations.set(from, { from, to, source });
        }
      } });
    }
  }
  return [...destinations.values()].sort((left, right) => left.from - right.from);
}

function restoreImages(markdownContent: string, images: DraftPastedImage[], aliases: Record<string, string> = {}) {
  const replacements = new Map<string, string>();
  const restored: DraftPastedImage[] = [];
  const createdSources: string[] = [];
  try {
    for (const { source, file } of images) {
      const next = URL.createObjectURL(file);
      createdSources.push(next);
      replacements.set(source, next);
      restored.push({ source: next, file });
    }
    for (const [alias, source] of Object.entries(aliases)) {
      const next = replacements.get(source);
      if (next) replacements.set(alias, next);
    }
    const destinations = imageDestinations(markdownContent, new Set(replacements.keys()));
    for (const destination of destinations.reverse()) {
      const next = replacements.get(destination.source)!;
      markdownContent = markdownContent.slice(0, destination.from) + next + markdownContent.slice(destination.to);
    }
    // A single address may occur both in an image and in a code example, or
    // in syntax with any delimiter missing. Keep these aliases tied to the
    // same file, without adding duplicate files to the editor or submission.
    const imageAliases = Object.fromEntries([...replacements].filter(([source]) => markdownContent.includes(source)));
    return { markdownContent, images: restored, createdSources, imageAliases };
  } catch (error) {
    for (const source of createdSources) URL.revokeObjectURL(source);
    throw error;
  }
}

// Bind an old address only once it is a parsed destination (or the existing
// closing-delimiter probe recognizes it). Transaction filters run before the
// editor's change callback, preview and hidden fields receive the document;
// no delayed dispatch can overwrite later typing or recreate the EditorView.
function DraftImageBindings({ aliases, children }: { aliases: Record<string, string>; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const replacements = new Map(Object.entries(aliases));
    if (!replacements.size) return;
    const sources = new Set(replacements.keys());
    const binding = EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged) return transaction;
      const destinations = imageDestinations(transaction.newDoc.toString(), sources);
      if (!destinations.length) return transaction;
      return [transaction, {
        changes: destinations.map(({ from, to, source }) => ({ from, to, insert: replacements.get(source)! })),
        sequential: true,
      }];
    });
    const installed = new Map<EditorView, Compartment>();
    const attach = () => {
      for (const element of container.querySelectorAll<HTMLElement>('.cm-editor')) {
        const view = EditorView.findFromDOM(element);
        if (!view || installed.has(view)) continue;
        const compartment = new Compartment();
        const lifecycle = ViewPlugin.define(() => ({ destroy: () => { installed.delete(view); } }));
        installed.set(view, compartment);
        view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of([binding, lifecycle])) });
      }
    };
    const observer = new MutationObserver(attach);
    observer.observe(container, { childList: true, subtree: true });
    attach();
    return () => {
      observer.disconnect();
      for (const [view, compartment] of installed) {
        view.dispatch({ effects: compartment.reconfigure([]) });
      }
      installed.clear();
    };
  }, [aliases]);
  return <div ref={root}>{children}</div>;
}

export function ResumeWorkLogEdit({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    try {
      const logId = readActive(userId);
      if (!logId) return;
      const snapshot = readSnapshot(userId, logId);
      if (snapshot?.draft.from === 'my') {
        router.replace(`/console/logs/${encodeURIComponent(logId)}/edit?from=my`);
      }
    } catch { /* An unavailable or invalid local draft must not block the list. */ }
  }, [userId, router]);
  return null;
}

export function MarkdownWorkLogEditDraft({
  userId, logId, from, initialValue, action, children,
}: {
  userId: string;
  logId: string;
  from: Origin;
  initialValue: string;
  action: (formData: FormData) => Promise<EditLogSaveResult>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [initial, setInitial] = useState<{ markdownContent: string; images: DraftPastedImage[]; imageAliases: Record<string, string> }>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const latest = useRef<Snapshot | undefined>(undefined);
  const mounted = useRef(false);
  const storageFailed = useRef(false);
  const pendingImages = useRef(0);
  const imagesFailed = useRef(false);
  const missingImages = useRef(false);
  const ended = useRef(false);

  function persist(snapshot: Snapshot) {
    if (ended.current) return;
    snapshots.set(draftKey(userId, logId), snapshot);
    if (from === 'my') activeEdits.set(userId, logId);
    try {
      window.localStorage.setItem(draftKey(userId, logId), JSON.stringify(snapshot.draft));
      if (from === 'my') window.localStorage.setItem(activeKey(userId), logId);
      storageFailed.current = false;
    } catch {
      storageFailed.current = true;
    }
    if (mounted.current) setNotice(storageFailed.current || imagesFailed.current || missingImages.current
      ? '草稿暂存于当前浏览器会话；刷新或关闭前请保留正文和原始图片。'
      : '未保存的编辑会自动保留，切换模块后可继续编辑。');
  }

  function persistImages(snapshot: Snapshot) {
    pendingImages.current += 1;
    void queueImages(userId, snapshot.draft, snapshot.images).then(() => {
      if (latest.current?.images === snapshot.images) imagesFailed.current = false;
    }).catch(() => {
      imagesFailed.current = true;
      if (mounted.current) setNotice('图片暂存于当前浏览器会话；刷新或关闭前请保留原始图片。');
    }).finally(() => { pendingImages.current -= 1; });
  }

  function change(markdownContent: string, images = latest.current?.images ?? []) {
    const current = latest.current;
    if (!current || ended.current) return;
    const imageSources = [...new Set([
      ...current.draft.imageSources.filter((source) => markdownContent.includes(source)),
      ...images.map((image) => image.source),
    ])];
    missingImages.current = imageSources.some((source) => !images.some((image) => image.source === source));
    const snapshot = {
      draft: { ...current.draft, markdownContent, imageSources, revision: crypto.randomUUID() },
      images,
    };
    latest.current = snapshot;
    persist(snapshot);
  }

  useEffect(() => {
    mounted.current = true;
    ended.current = false;
    let cancelled = false;
    const restoredSources: string[] = [];
    async function restore() {
      let snapshot: Snapshot | undefined;
      let imageError = false;
      const inMemory = snapshots.has(draftKey(userId, logId));
      try {
        snapshot = readSnapshot(userId, logId);
        if (snapshot && !inMemory && snapshot.draft.imageSources.length) {
          try {
            const saved = await readDraftImages(userId, imageId(snapshot.draft));
            snapshot.images = Array.isArray(saved) ? saved.filter((image) =>
              image && typeof image.source === 'string' && image.file instanceof File) : [];
          } catch { imageError = true; }
        }
      } catch { storageFailed.current = true; }
      if (cancelled) return;
      if (snapshot) {
        const available = new Set(snapshot.images.map((image) => image.source));
        imageError ||= snapshot.draft.imageSources.some((source) => !available.has(source));
        let recovered = { markdownContent: snapshot.draft.markdownContent, images: snapshot.images,
          createdSources: [] as string[], imageAliases: snapshot.draft.imageAliases ?? {} };
        try { recovered = restoreImages(snapshot.draft.markdownContent, snapshot.images, snapshot.draft.imageAliases); }
        catch { imageError = true; }
        restoredSources.push(...recovered.createdSources);
        const sources = new Map(snapshot.images.map((image, index) => [image.source, recovered.images[index].source]));
        snapshot = {
          draft: { ...snapshot.draft, from, markdownContent: recovered.markdownContent,
            imageAliases: recovered.imageAliases, imageSources: snapshot.draft.imageSources.map((source) => sources.get(source) ?? source) },
          images: recovered.images,
        };
      } else {
        snapshot = {
          draft: { version: 1, id: crypto.randomUUID(), logId, from, revision: crypto.randomUUID(), markdownContent: initialValue, imageSources: [] },
          images: [],
        };
      }
      latest.current = snapshot;
      missingImages.current = imageError;
      persist(snapshot);
      if (snapshot.images.length) persistImages(snapshot);
      if (imageError) setNotice('正文草稿已恢复，但图片存储不可用；请检查图片并在需要时重新粘贴。');
      setInitial({ markdownContent: snapshot.draft.markdownContent, images: snapshot.images,
        imageAliases: snapshot.draft.imageAliases ?? {} });
    }
    void restore().catch(() => {
      if (cancelled) return;
      setError('草稿恢复失败，请刷新重试；原草稿未被清除。');
    });
    const beforeClose = (event: BeforeUnloadEvent) => {
      if (!ended.current && (storageFailed.current || imagesFailed.current || missingImages.current || pendingImages.current > 0)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeClose);
    return () => {
      cancelled = true;
      mounted.current = false;
      window.removeEventListener('beforeunload', beforeClose);
      for (const source of restoredSources) URL.revokeObjectURL(source);
    };
    // The server page keys this component by user and log; ordinary edits must
    // never change the editor's initial props or recreate its EditorView.
  }, [userId, logId, from, initialValue]);

  async function submit(formData: FormData) {
    const snapshot = latest.current;
    if (!snapshot || ended.current) return;
    persist(snapshot);
    formData.set('markdownContent', snapshot.draft.markdownContent);
    formData.set('pastedImageSources', JSON.stringify(snapshot.images.map((image) => image.source)));
    formData.delete('pastedImages');
    for (const image of snapshot.images) formData.append('pastedImages', image.file);
    setError('');
    setSubmitting(true);
    try {
      const result = await action(formData);
      if (ended.current) return;
      if (result.saved) {
        const current = latest.current;
        if (current?.draft.id === snapshot.draft.id && current.draft.revision === snapshot.draft.revision) {
          ended.current = true;
          clearSnapshot(userId, snapshot.draft);
        }
      } else if (mounted.current) {
        setError('保存未完成，未保存的编辑已保留。');
      }
      if (result.redirectTo) {
        router.push(result.redirectTo);
        router.refresh();
      }
    } catch {
      if (mounted.current && !ended.current) setError('保存失败，未保存的编辑已保留，请稍后重试。');
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  const suffix = from === 'all' ? '' : `?from=${from}`;
  return <form className="wt-panel wt-form wt-markdown-form" action={submit}>
    <input type="hidden" name="id" value={logId} />
    <input type="hidden" name="from" value={from} />
    {children}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="wt-form-error" role="alert">{error}</p>}
    {!initial ? <p role="status">正在恢复编辑内容…</p> : <>
      <DraftImageBindings aliases={initial.imageAliases}><LogEditorLinks><MarkdownEditor initialValue={initial.markdownContent} initialPastedImages={initial.images}
        onChange={(value) => change(value)}
        onPastedImagesChange={(images) => {
          change(latest.current?.draft.markdownContent ?? '', images);
          if (latest.current) persistImages(latest.current);
        }} /></LogEditorLinks></DraftImageBindings>
      <WorkLogSubmissionStatus />
      <div className="wt-form-actions"><Link className="wt-secondary-button" href={`/console/logs/${encodeURIComponent(logId)}${suffix}`}
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          const snapshot = latest.current;
          if (snapshot) {
            ended.current = true;
            clearSnapshot(userId, snapshot.draft);
          }
        }}>取消</Link><WorkLogSubmitButton editing disabled={submitting} /></div>
    </>}
  </form>;
}
