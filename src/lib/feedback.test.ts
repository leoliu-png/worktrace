import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type LocalUser } from './db';
import type { FeedbackCategory, FeedbackInput, FeedbackStatus } from './feedback';

describe('persistent user feedback', () => {
  let db: ReturnType<typeof createDatabase>;
  let member: LocalUser;
  let other: LocalUser;
  let admin: LocalUser;
  const suggestion: FeedbackInput = { category: 'SUGGESTION', title: '导出日志', description: '希望可以把日志导出为 Markdown 文件。' };

  beforeEach(() => {
    db = createDatabase(':memory:');
    member = db.findOrCreateUser('member@feedmob.com', 'Member');
    other = db.findOrCreateUser('other@feedmob.com', 'Other');
    admin = db.findOrCreateUser('linden@feedmob.com', 'Linden');
  });
  afterEach(() => db.close());

  it('saves and audits feedback while keeping it separate from work logs', () => {
    const log = db.createWorkLog(member.id, { title: '工作日志', completed: ['已完成'] });
    const feedback = db.createFeedback(member.id, { ...suggestion, title: '  导出日志  ' });
    expect(db.getFeedback(feedback.id, member.id)).toMatchObject({ title: '导出日志', description: suggestion.description, authorId: member.id, authorName: 'Member', status: 'OPEN', reply: '' });
    expect(db.listWorkLogs(member.id).map((item) => item.id)).toEqual([log.id]);
    expect(db.listAuditEvents(member.id)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'FEEDBACK_CREATED', targetId: feedback.id })]));
  });

  it('only exposes a member’s own feedback and allows administrators to see all', () => {
    const mine = db.createFeedback(member.id, suggestion);
    const theirs = db.createFeedback(other.id, { ...suggestion, title: '其他人的建议' });
    expect(db.listFeedback(member.id).items.map((item) => item.id)).toEqual([mine.id]);
    expect(db.getFeedback(theirs.id, member.id)).toBeUndefined();
    expect(() => db.listFeedback(member.id, { all: true })).toThrow('Administrator');
    expect(db.listFeedback(admin.id, { all: true }).items).toHaveLength(2);
    expect(db.getFeedback(theirs.id, admin.id)?.authorId).toBe(other.id);
  });

  it('makes administrator replies and status updates visible to the submitter', () => {
    const feedback = db.createFeedback(member.id, suggestion);
    db.reviewFeedback(feedback.id, admin.id, { status: 'IN_PROGRESS', reply: ' 已列入下次优化计划。 ' });
    expect(db.getFeedback(feedback.id, member.id)).toMatchObject({ status: 'IN_PROGRESS', reply: '已列入下次优化计划。', reviewedBy: admin.id });
    expect(db.listAuditEvents(admin.id)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'FEEDBACK_REVIEWED', targetId: feedback.id })]));
  });

  it('rejects member reviews and ignores forged status fields during submission', () => {
    const feedback = db.createFeedback(member.id, { ...suggestion, status: 'COMPLETED' } as FeedbackInput);
    expect(feedback.status).toBe('OPEN');
    expect(() => db.reviewFeedback(feedback.id, member.id, { status: 'COMPLETED', reply: '伪造回复' })).toThrow('Administrator');
    expect(db.getFeedback(feedback.id, member.id)).toMatchObject({ status: 'OPEN', reply: '', reviewedBy: null });
  });

  it('rejects empty or excessive content and invalid categories before saving', () => {
    for (const input of [
      { ...suggestion, title: '   ' }, { ...suggestion, title: 'x'.repeat(121) },
      { ...suggestion, description: '' }, { ...suggestion, description: 'x'.repeat(5001) },
      { ...suggestion, category: 'INVALID' as FeedbackCategory },
    ]) expect(() => db.createFeedback(member.id, input)).toThrow();
    expect(db.listFeedback(member.id).items).toHaveLength(0);
  });

  it('rejects invalid reviews without changing the current feedback', () => {
    const feedback = db.createFeedback(member.id, suggestion);
    expect(() => db.reviewFeedback(feedback.id, admin.id, { status: 'INVALID' as FeedbackStatus, reply: '' })).toThrow();
    expect(() => db.reviewFeedback(feedback.id, admin.id, { status: 'COMPLETED', reply: 'x'.repeat(3001) })).toThrow();
    expect(() => db.reviewFeedback('missing', admin.id, { status: 'COMPLETED', reply: '' })).toThrow('not found');
    expect(db.getFeedback(feedback.id, member.id)).toMatchObject({ status: 'OPEN', reply: '' });
  });

  it('paginates without duplicates and applies status filters', () => {
    const created = Array.from({ length: 5 }, (_, index) => db.createFeedback(member.id, { ...suggestion, title: `建议 ${index}` }));
    const first = db.listFeedback(member.id, { limit: 2 });
    const second = db.listFeedback(member.id, { limit: 2, cursor: first.nextCursor! });
    const third = db.listFeedback(member.id, { limit: 2, cursor: second.nextCursor! });
    expect(new Set([...first.items, ...second.items, ...third.items].map((item) => item.id)).size).toBe(5);
    expect(third.nextCursor).toBeNull();
    db.reviewFeedback(created[0].id, admin.id, { status: 'COMPLETED', reply: '已实现。' });
    expect(db.listFeedback(member.id, { status: 'COMPLETED' }).items.map((item) => item.id)).toEqual([created[0].id]);
  });

  it('keeps account deletion compatible with feedback foreign keys', () => {
    const feedback = db.createFeedback(member.id, suggestion);
    db.reviewFeedback(feedback.id, admin.id, { status: 'COMPLETED', reply: '已处理。' });
    db.deleteUser(member.id, admin.id);
    expect(db.listFeedback(admin.id, { all: true }).items).toHaveLength(0);
  });
});
