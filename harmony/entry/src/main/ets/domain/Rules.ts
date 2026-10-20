export interface Checkpoint { version: number; values: Record<string, string | null>; }
export const WORKSPACE_KEYS: string[] = ['suike.timetable.v1', 'suike.history.v1', 'suike.semesters.v1', 'suike.workspace.transaction.v1'];
export function validCheckpoint(text: string): boolean {
  if (text.length > 12 * 1024 * 1024) return false;
  try {
    const v = JSON.parse(text) as Checkpoint;
    if (!v || v.version !== 1 || Object.keys(v).sort().join('|') !== 'values|version' || !v.values || Array.isArray(v.values)) return false;
    if (Object.keys(v.values).sort().join('|') !== WORKSPACE_KEYS.slice().sort().join('|')) return false;
    return WORKSPACE_KEYS.every((k: string) => v.values[k] === null || typeof v.values[k] === 'string');
  } catch (_) { return false; }
}
export interface Occurrence { id: string; courseId: string; date: string; name: string; room: string; startMillis: number; endMillis: number; }
export interface Override { enabled?: boolean; leadMinutes?: number; }
export interface FeaturePayload {
  schemaVersion: number; theme: string; enabled: boolean; leadMinutes: number;
  mutedCourseIds: string[]; courseOverrides: Record<string, Override>; occurrences: Occurrence[];
}
export interface Appearance { glass: boolean; frost: number; reducedMotion: boolean; }
export interface ReminderPlan { occurrence: Occurrence; at: number; }
export interface CardSnapshot {
  title: string; room: string; clock: string; state: string; active: boolean; progress: number;
  next: string; date: string; theme: string; glass: boolean; frost: number; reducedMotion: boolean;
  generatedAt: number; nextRefresh: number;
}
export function emptyFeatures(): FeaturePayload { return { schemaVersion: 1, theme: 'auto', enabled: false, leadMinutes: 10, mutedCourseIds: [], courseOverrides: {}, occurrences: [] }; }
export function parseFeatures(text: string): FeaturePayload {
  if (text.length > 1000000) throw new Error('FEATURE_TOO_LARGE');
  const p = JSON.parse(text) as FeaturePayload;
  if (!p || p.schemaVersion !== 1 || !['auto','light','dark'].includes(p.theme) || typeof p.enabled !== 'boolean' || !Number.isInteger(p.leadMinutes) || p.leadMinutes < 0 || p.leadMinutes > 120 || !Array.isArray(p.occurrences) || p.occurrences.length > 1500 || !Array.isArray(p.mutedCourseIds) || !p.courseOverrides || Array.isArray(p.courseOverrides)) throw new Error('FEATURE_INVALID');
  const seen: Set<string> = new Set<string>();
  p.occurrences.forEach((o: Occurrence) => {
    if (!o || typeof o.id !== 'string' || o.id.length > 160 || seen.has(o.id) || typeof o.courseId !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(o.date) || typeof o.name !== 'string' || o.name.length > 80 || typeof o.room !== 'string' || o.room.length > 80 || !Number.isFinite(o.startMillis) || !Number.isFinite(o.endMillis) || o.endMillis <= o.startMillis || o.endMillis - o.startMillis > 86400000) throw new Error('OCCURRENCE_INVALID');
    seen.add(o.id);
  });
  p.mutedCourseIds.forEach((id: string) => { if (typeof id !== 'string' || id.length > 160) throw new Error('OVERRIDE_INVALID'); });
  Object.keys(p.courseOverrides).forEach((id: string) => {
    const v = p.courseOverrides[id];
    if (!v || id.length > 160 || (v.enabled !== undefined && typeof v.enabled !== 'boolean') || (v.leadMinutes !== undefined && (!Number.isInteger(v.leadMinutes) || v.leadMinutes < 0 || v.leadMinutes > 120))) throw new Error('OVERRIDE_INVALID');
  });
  return p;
}
export function reminderPlan(p: FeaturePayload, now: number): ReminderPlan[] {
  if (!p.enabled) return [];
  const result: ReminderPlan[] = [];
  p.occurrences.forEach((o: Occurrence) => {
    const rule = p.courseOverrides[o.courseId];
    const enabled = rule && rule.enabled !== undefined ? rule.enabled : !p.mutedCourseIds.includes(o.courseId);
    const lead = rule && rule.leadMinutes !== undefined ? rule.leadMinutes : p.leadMinutes;
    const at = o.startMillis - lead * 60000;
    if (enabled && at > now) result.push({ occurrence: o, at: at });
  });
  return result.sort((a: ReminderPlan,b: ReminderPlan) => a.at-b.at);
}
export function shanghaiDay(ms: number): string { return new Date(ms + 8 * 3600000).toISOString().slice(0,10); }
export function shanghaiClock(ms: number): string { return new Date(ms + 8 * 3600000).toISOString().slice(11,16); }
export function cardSnapshot(p: FeaturePayload, a: Appearance, now: number): CardSnapshot {
  const upcoming = p.occurrences.filter((o: Occurrence) => o.endMillis > now).sort((x: Occurrence,y: Occurrence) => x.startMillis-y.startMillis);
  const live = upcoming.find((o: Occurrence) => o.startMillis <= now);
  const day = shanghaiDay(now);
  const first = live || upcoming.find((o: Occurrence) => o.date === day);
  const next = first ? upcoming.find((o: Occurrence) => o.id !== first.id && o.startMillis >= first.endMillis) : undefined;
  const progress = live ? Math.min(1,Math.max(0,(now-live.startMillis)/(live.endMillis-live.startMillis))) : 0;
  const tomorrow = upcoming[0];
  return { title: first ? first.name : '今日课程已结束', room: first ? first.room : '', clock: first ? shanghaiClock(first.startMillis)+'–'+shanghaiClock(first.endMillis) : '', state: live ? '正在上课' : first ? '下一节' : '暂无课程', active: !!live, progress: progress, next: next ? next.name+' · '+shanghaiClock(next.startMillis) : !first && tomorrow ? tomorrow.date.slice(5)+' · '+tomorrow.name : '', date: day, theme:p.theme, glass:a.glass, frost:a.frost, reducedMotion:a.reducedMotion, generatedAt:now, nextRefresh:live ? Math.min(live.endMillis,Math.floor(now/60000)*60000+60000) : first ? first.startMillis : now+1800000 };
}
