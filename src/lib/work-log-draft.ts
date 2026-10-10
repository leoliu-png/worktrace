export type WorkLogDraft = {
  version: 1;
  id: string;
  revision: string;
  markdownContent: string;
  reportDate: string;
  updatedAt: string;
};

export type DraftPastedImage = { source: string; file: File };
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function workLogDraftKey(userId: string) {
  return `worktrace:new-log-draft:v1:${encodeURIComponent(userId)}`;
}

export function readWorkLogDraft(storage: DraftStorage, userId: string): WorkLogDraft | undefined {
  const value = storage.getItem(workLogDraftKey(userId));
  if (!value) return undefined;
  const draft = JSON.parse(value) as Partial<WorkLogDraft> | null;
  if (!draft || draft.version !== 1 || typeof draft.id !== 'string' || !draft.id
    || typeof draft.revision !== 'string' || !draft.revision
    || typeof draft.markdownContent !== 'string'
    || typeof draft.reportDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(draft.reportDate)
    || Number.isNaN(Date.parse(`${draft.reportDate}T00:00:00.000Z`))
    || new Date(`${draft.reportDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== draft.reportDate
    || typeof draft.updatedAt !== 'string' || Number.isNaN(Date.parse(draft.updatedAt))) {
    throw new Error('Invalid work log draft');
  }
  return draft as WorkLogDraft;
}

export function writeWorkLogDraft(storage: DraftStorage, userId: string, draft: WorkLogDraft) {
  storage.setItem(workLogDraftKey(userId), JSON.stringify(draft));
}

// An older successful submission must not erase edits made while it was saving.
export function clearSubmittedWorkLogDraft(storage: DraftStorage, userId: string, submitted: Pick<WorkLogDraft, 'id' | 'revision'>) {
  const current = readWorkLogDraft(storage, userId);
  if (!current || current.id !== submitted.id || current.revision !== submitted.revision) return false;
  storage.removeItem(workLogDraftKey(userId));
  return true;
}

export function restoreDraftImages(markdownContent: string, images: DraftPastedImage[], createSource = (file: File) => URL.createObjectURL(file)) {
  const restored = images.filter((image) => markdownContent.includes(`](${image.source})`))
    .map((image) => ({ ...image, previousSource: image.source, source: createSource(image.file) }));
  const markdown = restored.reduce((text, image) => text.replaceAll(image.previousSource, image.source), markdownContent);
  const missingImages = /!\[[^\]]*\]\((blob:[^\s)]+)\)/g;
  const missing = [...markdown.matchAll(missingImages)].some((match) => !restored.some((image) => image.source === match[1]));
  return { markdownContent: markdown, images: restored.map(({ source, file }) => ({ source, file })), missing };
}

function imageKey(userId: string, draftId: string) { return `${workLogDraftKey(userId)}:${draftId}`; }

function openDraftImages(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('worktrace-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Draft image storage is unavailable'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Draft image storage is blocked'));
    };
  });
}

export async function readDraftImages(userId: string, draftId: string): Promise<DraftPastedImage[]> {
  const database = await openDraftImages();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('images', 'readonly');
      const request = transaction.objectStore('images').get(imageKey(userId, draftId));
      transaction.oncomplete = () => resolve(request.result ?? []);
      transaction.onabort = () => reject(transaction.error ?? new Error('Draft images could not be read'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Draft images could not be read'));
    });
  } finally { database.close(); }
}

export async function writeDraftImages(userId: string, draftId: string, images: DraftPastedImage[]) {
  const database = await openDraftImages();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('images', 'readwrite');
      transaction.objectStore('images').put(images, imageKey(userId, draftId));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Draft images could not be saved'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Draft images could not be saved'));
    });
  } finally { database.close(); }
}

export async function removeDraftImages(userId: string, draftId: string) {
  const database = await openDraftImages();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('images', 'readwrite');
      transaction.objectStore('images').delete(imageKey(userId, draftId));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Draft images could not be removed'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Draft images could not be removed'));
    });
  } finally { database.close(); }
}
