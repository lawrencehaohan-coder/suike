import { common } from '@kit.AbilityKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { formBindingData, formProvider } from '@kit.FormKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { AtomicStore } from './AtomicStore';
import {
  Appearance, CardSnapshot, FeaturePayload, ReminderPlan,
  cardSnapshot, emptyFeatures, parseFeatures, reminderPlan, shanghaiClock
} from '../domain/Rules';

// This project supports API 12. Ordinary applications on API 12–20 have at
// most 30 valid agent reminders. A successful publish is not proof of delivery.
const REMINDER_CAPACITY: number = 30;
const NOTIFICATION_BASE: number = 510000;
export const FEATURE_FILE: string = 'features.json';
export const APPEARANCE_FILE: string = 'appearance.json';
export const FORM_REGISTRY_FILE: string = 'course-forms.json';

export interface CourseFormRecord { id: string; wide: boolean; }
export interface CourseFormRegistry { version: number; forms: CourseFormRecord[]; }
export interface CourseCardData extends CardSnapshot {
  wide: boolean; dark: boolean; generatedClock: string;
}
interface PublishedReminder { id: number; occurrenceId: string; at: number; notificationId: number; }
interface FeatureStatus {
  ok: boolean; platform: string; notificationsAllowed: boolean | null;
  notificationPermission: boolean | null; remindersEnabled: boolean;
  configurationPending: boolean; configPersisted: boolean; appearancePersisted: boolean;
  reminderState: string; requested: number; scheduled: number; pending: number; capacity: number;
  nextUnscheduledAt: number | null; refreshNeededBefore: number | null;
  scheduleVerifiedAt: number; lastRefresh: number; reminderError: string; reminderMessage: string;
  cardState: string; cardCount: number; cardUpdatedCount: number; cardError: string; cardMessage: string;
  pinSupported: boolean; pinInstruction: string; deliveryVerified: boolean; message: string;
}

export function readFeatures(store: AtomicStore): FeaturePayload {
  const text = store.read(FEATURE_FILE);
  return text === null ? emptyFeatures() : parseFeatures(text);
}

export function readAppearance(store: AtomicStore): Appearance {
  const text = store.read(APPEARANCE_FILE);
  if (text === null) return { glass: false, frost: 0, reducedMotion: false };
  const value = JSON.parse(text) as Appearance;
  if (!value || typeof value.glass !== 'boolean' || typeof value.reducedMotion !== 'boolean' ||
    !Number.isFinite(value.frost) || value.frost < 0 || value.frost > 100) {
    throw new Error('APPEARANCE_INVALID');
  }
  return value;
}

export function readCourseForms(store: AtomicStore): CourseFormRegistry {
  const text = store.read(FORM_REGISTRY_FILE);
  if (text === null) return { version: 1, forms: [] };
  const value = JSON.parse(text) as CourseFormRegistry;
  if (!value || value.version !== 1 || !Array.isArray(value.forms) || value.forms.length > 128) {
    throw new Error('FORM_REGISTRY_INVALID');
  }
  const seen: Set<string> = new Set<string>();
  value.forms.forEach((record: CourseFormRecord) => {
    if (!record || typeof record.id !== 'string' || !/^[0-9]{1,24}$/.test(record.id) ||
      typeof record.wide !== 'boolean' || seen.has(record.id)) throw new Error('FORM_REGISTRY_INVALID');
    seen.add(record.id);
  });
  return value;
}

export function systemDark(context: common.Context): boolean {
  try { return context.resourceManager.getConfigurationSync().colorMode === 0; }
  catch (_) { return false; }
}

export function createCourseCardData(store: AtomicStore, darkSystem: boolean, wide: boolean): CourseCardData {
  let features = emptyFeatures();
  let appearance: Appearance = { glass: false, frost: 0, reducedMotion: false };
  let invalid = false;
  try { features = readFeatures(store); } catch (_) { invalid = true; }
  try { appearance = readAppearance(store); } catch (_) { invalid = true; }
  const snapshot = cardSnapshot(features, appearance, Date.now());
  return {
    title: invalid ? '课程数据需要重新同步' : snapshot.title,
    room: invalid ? '' : snapshot.room, clock: invalid ? '' : snapshot.clock,
    state: invalid ? '请打开随课' : snapshot.state, active: !invalid && snapshot.active,
    progress: invalid ? 0 : snapshot.progress, next: invalid ? '打开应用检查本机保存的数据' : snapshot.next,
    date: snapshot.date, theme: snapshot.theme, glass: snapshot.glass, frost: snapshot.frost,
    reducedMotion: snapshot.reducedMotion, generatedAt: snapshot.generatedAt, nextRefresh: snapshot.nextRefresh,
    wide: wide, dark: features.theme === 'dark' || (features.theme === 'auto' && darkSystem),
    generatedClock: shanghaiClock(snapshot.generatedAt)
  };
}

export class FeatureService {
  private context: common.UIAbilityContext;
  private store: AtomicStore;
  private payload: FeaturePayload = emptyFeatures();
  private disposed: boolean = false;
  private revision: number = 0;
  private queue: Promise<void> = Promise.resolve();
  private cardTimer: number = -1;
  private permissionBusy: boolean = false;
  private permissionRequest: Promise<void> = Promise.resolve();
  private state: FeatureStatus = {
    ok: true, platform: 'harmony', notificationsAllowed: null, notificationPermission: null,
    remindersEnabled: false, configurationPending: true, configPersisted: true, appearancePersisted: true,
    reminderState: 'unverified', requested: 0, scheduled: 0, pending: 0, capacity: REMINDER_CAPACITY,
    nextUnscheduledAt: null, refreshNeededBefore: null, scheduleVerifiedAt: 0, lastRefresh: 0,
    reminderError: '', reminderMessage: '尚未向系统查询提醒状态。',
    cardState: 'unverified', cardCount: 0, cardUpdatedCount: 0, cardError: '',
    cardMessage: '卡片显示最近一次刷新时的课程进度；系统后台刷新并非实时。',
    pinSupported: false, pinInstruction: '长按随课桌面图标，选择服务卡片，再选择 2×2 或 2×4 添加。',
    deliveryVerified: false, message: '正在读取本机配置。'
  };

  constructor(context: common.UIAbilityContext, store: AtomicStore) {
    this.context = context;
    this.store = store;
    try {
      this.payload = readFeatures(store);
      if (store.read(FEATURE_FILE) === null) this.state.configPersisted = store.write(FEATURE_FILE, JSON.stringify(this.payload));
      if (!this.state.configPersisted) throw new Error('FEATURE_WRITE_FAILED');
    }
    catch (_) {
      this.state.ok = false; this.state.configPersisted = false;
      this.state.reminderError = 'FEATURE_READ_FAILED';
      this.state.reminderMessage = '本机提醒配置读取失败，请重新保存提醒设置。';
    }
    try {
      const appearance = readAppearance(store);
      if (store.read(APPEARANCE_FILE) === null) this.state.appearancePersisted = store.write(APPEARANCE_FILE, JSON.stringify(appearance));
      if (!this.state.appearancePersisted) throw new Error('APPEARANCE_WRITE_FAILED');
    }
    catch (_) { this.state.appearancePersisted = false; this.state.cardError = 'APPEARANCE_READ_FAILED'; }
    this.state.remindersEnabled = this.payload.enabled;
    // This timer improves snapshots only while this page's service is alive.
    // It is not a background task and is never used to promise reminder delivery.
    this.cardTimer = setInterval(() => {
      if (this.disposed) return;
      this.queue = this.queue.then(async () => {
        if (!this.disposed) await this.updateCards();
      }).catch(() => { this.state.cardState = 'error'; this.state.cardError = 'CARD_REFRESH_FAILED'; });
    }, 60000);
  }

  sync(payload: string): boolean {
    if (this.disposed) return false;
    try {
      const parsed = parseFeatures(payload);
      if (!this.store.write(FEATURE_FILE, JSON.stringify(parsed))) throw new Error('FEATURE_WRITE_FAILED');
      this.payload = parsed; this.revision += 1;
      this.state.configPersisted = true; this.state.configurationPending = true;
      this.state.remindersEnabled = parsed.enabled; this.state.reminderError = '';
      this.state.reminderState = 'pending';
      this.state.reminderMessage = '设置已保存，等待系统取消旧提醒并重新调度。';
      return true;
    } catch (_) {
      this.state.ok = false; this.state.configPersisted = false;
      this.state.reminderError = 'FEATURE_INVALID_OR_NOT_SAVED';
      this.state.reminderMessage = '提醒设置未保存，原来的系统提醒可能仍然有效。';
      return false;
    }
  }

  appearance(glass: boolean, frost: number, reducedMotion: boolean): boolean {
    if (this.disposed) return false;
    if (typeof glass !== 'boolean' || typeof reducedMotion !== 'boolean' ||
      !Number.isFinite(frost) || frost < 0 || frost > 100) {
      this.state.appearancePersisted = false; this.state.cardError = 'APPEARANCE_INVALID';
      this.state.cardMessage = '外观设置无效，未保存本次修改。'; return false;
    }
    const appearance: Appearance = { glass: glass, frost: frost, reducedMotion: reducedMotion };
    const saved = this.store.write(APPEARANCE_FILE, JSON.stringify(appearance));
    this.state.appearancePersisted = saved;
    if (!saved) { this.state.ok = false; this.state.cardError = 'APPEARANCE_WRITE_FAILED'; }
    else { this.state.cardError = ''; this.state.cardState = 'pending'; }
    return saved;
  }

  status(): string {
    this.state.ok = this.state.configPersisted && this.state.appearancePersisted &&
      this.state.reminderError.length === 0 && this.state.cardError.length === 0;
    this.state.message = this.state.reminderMessage + ' ' + this.state.cardMessage;
    return JSON.stringify(this.state);
  }

  requestPermission(): void {
    if (this.disposed || this.permissionBusy) return;
    this.permissionBusy = true;
    this.state.reminderState = 'permission-request';
    this.state.reminderMessage = '请在系统弹窗中选择是否允许通知；拒绝后可到系统设置开启。';
    try {
      this.permissionRequest = notificationManager.requestEnableNotification(this.context).then(() => {
        this.permissionBusy = false;
      }).catch((error: BusinessError) => {
        this.permissionBusy = false;
        this.state.notificationsAllowed = null; this.state.notificationPermission = null;
        this.state.reminderState = 'permission-error'; this.state.reminderError = this.errorCode(error);
        this.state.reminderMessage = '未取得通知授权，请在系统设置的随课通知管理中检查。';
      });
    } catch (error) {
      this.permissionBusy = false;
      this.state.reminderState = 'permission-error'; this.state.reminderError = this.errorCode(error as BusinessError);
      this.state.reminderMessage = '通知授权请求失败，请在系统设置检查随课的通知权限。';
      return;
    }
    this.permissionRequest.then(() => { if (!this.disposed) this.refresh().catch(() => {}); });
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const job = this.queue.then(async () => {
      if (this.disposed) return;
      await this.permissionRequest;
      if (this.disposed) return;
      await this.rebuildReminders();
      await this.updateCards();
      this.state.lastRefresh = Date.now();
      this.state.ok = this.state.configPersisted && this.state.appearancePersisted &&
        this.state.reminderError.length === 0 && this.state.cardError.length === 0;
    });
    this.queue = job.catch(() => {
      this.state.ok = false; this.state.reminderState = 'error';
      this.state.reminderError = 'FEATURE_REFRESH_FAILED';
      this.state.reminderMessage = '系统状态刷新失败，请重新打开随课后检查。';
    });
    return this.queue;
  }

  dispose(): void {
    this.disposed = true;
    if (this.cardTimer >= 0) clearInterval(this.cardTimer);
    this.cardTimer = -1;
    // System agent reminders intentionally remain after the app page closes.
  }

  private async rebuildReminders(): Promise<void> {
    if (!this.state.configPersisted) {
      this.state.reminderState = 'configuration-error';
      return;
    }
    const revision = this.revision;
    const payload = this.payload;
    const plan = reminderPlan(payload, Date.now());
    this.state.reminderState = 'scheduling'; this.state.reminderError = '';
    this.state.configurationPending = true;
    this.state.scheduleVerifiedAt = 0;
    this.state.requested = plan.length; this.state.pending = plan.length;
    this.state.nextUnscheduledAt = plan.length ? plan[0].at : null;
    this.state.refreshNeededBefore = this.state.nextUnscheduledAt;
    try {
      // Cancels only this application's reminders, including stale published
      // reminders from an interrupted process or a changed semester/course.
      await reminderAgentManager.cancelAllReminders();
      this.state.scheduled = 0;
    } catch (error) {
      this.state.reminderState = 'cancel-error'; this.state.reminderError = this.errorCode(error as BusinessError);
      this.state.reminderMessage = '系统未确认取消旧提醒；为避免重复，本次没有发布新提醒。';
      return;
    }
    if (revision !== this.revision) return;
    try {
      const allowed = await notificationManager.isNotificationEnabled();
      this.state.notificationsAllowed = allowed; this.state.notificationPermission = allowed;
    } catch (error) {
      this.state.notificationsAllowed = null; this.state.notificationPermission = null;
      this.state.reminderState = 'permission-query-error'; this.state.reminderError = this.errorCode(error as BusinessError);
      this.state.reminderMessage = '系统通知权限查询失败；没有发布新提醒。';
      return;
    }
    if (revision !== this.revision) return;
    if (!payload.enabled) {
      this.state.configurationPending = false; this.state.reminderState = 'disabled';
      this.state.pending = 0; this.state.nextUnscheduledAt = null; this.state.refreshNeededBefore = null;
      this.state.reminderMessage = '提醒已关闭，系统已确认取消本应用的旧提醒。';
      this.state.scheduleVerifiedAt = Date.now(); return;
    }
    if (this.state.notificationsAllowed !== true) {
      this.state.reminderState = 'permission-denied';
      this.state.reminderMessage = '设置已保存，但系统通知尚未开启，没有发布提醒；请在系统设置允许随课通知后重开应用。';
      return;
    }
    const published: PublishedReminder[] = [];
    const remaining: ReminderPlan[] = [];
    for (let index = 0; index < plan.length; index++) {
      if (revision !== this.revision) return;
      const item = plan[index];
      if (item.at <= Date.now()) continue; // Never report an elapsed reminder as sent.
      if (published.length >= REMINDER_CAPACITY || this.state.reminderError.length > 0) {
        remaining.push(item); continue;
      }
      const notificationId = NOTIFICATION_BASE + published.length;
      try {
        const id = await reminderAgentManager.publishReminder(this.request(item, notificationId));
        published.push({ id: id, occurrenceId: item.occurrence.id, at: item.at, notificationId: notificationId });
      } catch (error) {
        this.state.reminderError = this.errorCode(error as BusinessError);
        remaining.push(item);
      }
    }
    if (revision !== this.revision) return;
    this.state.scheduled = published.length; this.state.pending = remaining.length;
    this.state.nextUnscheduledAt = remaining.length ? remaining[0].at : null;
    this.state.refreshNeededBefore = this.state.nextUnscheduledAt;
    try {
      const valid = await reminderAgentManager.getValidReminders();
      if (revision !== this.revision) return;
      const confirmed = valid.filter((request: reminderAgentManager.ReminderRequest) =>
        published.some((entry: PublishedReminder) => entry.notificationId === request.notificationId)).length;
      this.state.scheduled = confirmed; this.state.scheduleVerifiedAt = Date.now();
      if (confirmed !== published.length) {
        this.state.reminderError = 'SYSTEM_SCHEDULE_MISMATCH';
        this.state.configurationPending = true;
        const missing = published.filter((entry: PublishedReminder) => entry.at > Date.now() &&
          !valid.some((request: reminderAgentManager.ReminderRequest) => request.notificationId === entry.notificationId));
        this.state.pending = remaining.length + missing.length;
        const pendingAt = remaining.map((item: ReminderPlan) => item.at).concat(missing.map((entry: PublishedReminder) => entry.at));
        if (pendingAt.length > 0) {
          this.state.nextUnscheduledAt = pendingAt.sort((first: number, second: number) => first - second)[0];
          this.state.refreshNeededBefore = this.state.nextUnscheduledAt;
        }
      }
    } catch (error) {
      this.state.reminderError = this.errorCode(error as BusinessError);
      this.state.reminderState = 'verification-error';
      this.state.reminderMessage = '系统已返回 ' + published.length + ' 个发布回执，但无法复核有效提醒；请重开应用检查。';
      return;
    }
    this.state.configurationPending = this.state.pending > 0 || this.state.reminderError.length > 0;
    if (this.state.reminderError.length > 0) {
      this.state.reminderState = this.state.reminderError === '1700002' ? 'system-limit' : 'partial-error';
      this.state.reminderMessage = '系统确认 ' + this.state.scheduled + ' 个提醒，另有 ' + this.state.pending +
        ' 个未安排。错误 ' + this.state.reminderError + '；请重开随课重试。';
    } else if (remaining.length > 0) {
      this.state.reminderState = 'limited';
      this.state.reminderMessage = '系统确认最近 ' + this.state.scheduled + ' 个提醒，受 30 个上限限制，另有 ' +
        remaining.length + ' 个待安排；请在 ' + this.when(remaining[0].at) + ' 前重开随课刷新。';
    } else {
      this.state.reminderState = published.length > 0 ? 'scheduled' : 'empty';
      this.state.reminderMessage = published.length > 0 ? '系统已确认安排 ' + this.state.scheduled +
        ' 个提醒；实际送达受系统通知设置影响，应用无法验证送达。' : '当前没有尚未到时的提醒；没有补发已经过去的提醒。';
    }
  }

  private request(plan: ReminderPlan, notificationId: number): reminderAgentManager.ReminderRequestCalendar {
    // LocalDateTime uses the device time zone. Local getters preserve this
    // absolute occurrence at scheduling time; reopen after a device zone change.
    const date = new Date(plan.at);
    return {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
      dateTime: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
        hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() },
      actionButton: [{ title: '关闭', type: reminderAgentManager.ActionButtonType.ACTION_BUTTON_TYPE_CLOSE }],
      wantAgent: { pkgName: this.context.abilityInfo.bundleName, abilityName: 'EntryAbility' },
      title: plan.occurrence.name,
      content: shanghaiClock(plan.occurrence.startMillis) + ' 上课' +
        (plan.occurrence.room.length > 0 ? ' · ' + plan.occurrence.room : ''),
      expiredContent: '本次课程提醒时间已过', notificationId: notificationId,
      slotType: notificationManager.SlotType.CONTENT_INFORMATION, ringDuration: 0,
      snoozeTimes: 0, tapDismissed: true
    };
  }

  private async updateCards(): Promise<void> {
    this.state.cardError = ''; this.state.cardUpdatedCount = 0;
    let registry: CourseFormRegistry;
    try { registry = readCourseForms(this.store); }
    catch (_) {
      this.state.cardState = 'registry-error'; this.state.cardError = 'FORM_REGISTRY_READ_FAILED';
      this.state.cardMessage = '卡片登记读取失败，请移除并重新添加随课服务卡片。'; return;
    }
    this.state.cardCount = registry.forms.length;
    if (registry.forms.length === 0) {
      this.state.cardState = 'not-added';
      this.state.cardMessage = '服务卡片尚未添加。' + this.state.pinInstruction; return;
    }
    for (const form of registry.forms) {
      try {
        const data = createCourseCardData(this.store, systemDark(this.context), form.wide);
        await formProvider.updateForm(form.id, formBindingData.createFormBindingData(data));
        this.state.cardUpdatedCount += 1;
      } catch (error) { this.state.cardError = this.errorCode(error as BusinessError); }
    }
    this.state.cardState = this.state.cardError.length ? 'partial-error' : 'updated';
    this.state.cardMessage = '已更新 ' + this.state.cardUpdatedCount + '/' + registry.forms.length +
      ' 张卡片；进度为最近刷新快照。后台刷新时间和频次由系统限制，卡片采用白/黑实色适配，不提供网页玻璃折射。';
  }

  private errorCode(error: BusinessError): string {
    return error && typeof error.code === 'number' ? String(error.code) : 'SYSTEM_CALL_FAILED';
  }

  private when(at: number): string {
    const date = new Date(at + 8 * 3600000);
    return date.toISOString().slice(5, 10) + ' ' + shanghaiClock(at) + '（北京时间）';
  }
}
