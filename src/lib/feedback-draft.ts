import { feedbackCategories, type FeedbackCategory } from './feedback';

export type FeedbackDraft = {
  category: FeedbackCategory;
  title: string;
  description: string;
};

export const emptyFeedbackDraft = (): FeedbackDraft => ({
  category: 'SUGGESTION',
  title: '',
  description: '',
});

// Also retain drafts during client navigation when browser storage is unavailable.
// A cached null prevents a failed storage removal from reviving a submitted draft.
const drafts = new Map<string, FeedbackDraft | null>();
const listeners = new Map<string, Set<() => void>>();
const revisions = new Map<string, number>();
const storageKey = (userId: string) => `worktrace:feedback-draft:v1:${userId}`;

function isFeedbackDraft(value: unknown): value is FeedbackDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<FeedbackDraft>;
  return feedbackCategories.some(category => category === draft.category)
    && typeof draft.title === 'string' && draft.title.length <= 120
    && typeof draft.description === 'string' && draft.description.length <= 5000;
}

function sameDraft(left: FeedbackDraft, right: FeedbackDraft) {
  return left.category === right.category && left.title === right.title && left.description === right.description;
}

export function getFeedbackDraftRevision(userId: string): number {
  return revisions.get(userId) ?? 0;
}

export function subscribeFeedbackDraft(userId: string, listener: () => void): () => void {
  if (typeof window === 'undefined' || !userId) return () => {};
  const subscribers = listeners.get(userId) ?? new Set<() => void>();
  listeners.set(userId, subscribers);
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(userId);
  };
}

function notifyFeedbackDraft(userId: string): void {
  listeners.get(userId)?.forEach(listener => listener());
}

export function readFeedbackDraft(userId: string): FeedbackDraft | null {
  if (typeof window === 'undefined' || !userId) return null;
  if (drafts.has(userId)) {
    const draft = drafts.get(userId);
    return draft ? { ...draft } : null;
  }

  let draft: FeedbackDraft | null = null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));
    const stored: unknown = raw === null ? null : JSON.parse(raw);
    if (stored && typeof stored === 'object') {
      const record = stored as { version?: unknown; userId?: unknown; draft?: unknown };
      if (record.version === 1 && record.userId === userId && isFeedbackDraft(record.draft)) {
        draft = { ...record.draft };
      }
    }
  } catch {
    // Blocked storage and malformed drafts must not prevent using the form.
  }
  drafts.set(userId, draft);
  return draft ? { ...draft } : null;
}

export function saveFeedbackDraft(userId: string, draft: FeedbackDraft): void {
  if (typeof window === 'undefined' || !userId) return;
  if (sameDraft(draft, emptyFeedbackDraft())) {
    clearFeedbackDraft(userId);
    return;
  }
  drafts.set(userId, { ...draft });
  revisions.set(userId, getFeedbackDraftRevision(userId) + 1);
  try {
    window.sessionStorage.setItem(storageKey(userId), JSON.stringify({ version: 1, userId, draft }));
  } catch {
    // The in-memory copy still survives navigation within this tab.
  }
  notifyFeedbackDraft(userId);
}

export function clearFeedbackDraft(userId: string, submittedDraft?: FeedbackDraft, submittedRevision?: number): void {
  if (typeof window === 'undefined' || !userId) return;
  const current = readFeedbackDraft(userId);
  // Preserve later edits even when their text has been changed back to the submitted text.
  if (submittedRevision !== undefined && submittedRevision !== getFeedbackDraftRevision(userId)) return;
  // An earlier submission may finish after the user returns and starts a new draft.
  if (submittedDraft && current && !sameDraft(current, submittedDraft)) return;
  drafts.set(userId, null);
  revisions.set(userId, getFeedbackDraftRevision(userId) + 1);
  try {
    window.sessionStorage.removeItem(storageKey(userId));
  } catch {
    // Keep the cached tombstone even if storage is no longer writable.
  }
  notifyFeedbackDraft(userId);
}
