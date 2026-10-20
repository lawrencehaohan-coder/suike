/* Suike's local workspace operations. No DOM, network, or implicit storage access.
 *
 * Storage contract: createWorkspaceStore is the ONLY writer of the timetable,
 * history and semester keys. Call commit(current, next, reason) before replacing
 * the in-memory state. It returns {state, changed}; a thrown error means keep the
 * current in-memory state. Semester methods save current state into its archive
 * and persist the pre-change snapshot before writing the destination timetable.
 * A failure rolls back attempted writes; rollbackFailed signals a damaged storage
 * adapter and callers must reload before further writes. localStorage cannot
 * provide crash-atomic multi-key commits, so every semester transaction also has
 * a durable journal, recovered before the next store read/write. The journal is
 * separate from history and never copied into a timetable backup.
 *
 * Pure planCreateSemester/planSwitchSemester return {state, archive, activeId}.
 * Pure occurrence helpers remap import-ledger associations while preserving the
 * source baseline, so subsequent imports still identify manual changes/deletions.
 * All validators receive cloned JSON data; returned states are independent copies.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuikeWorkspaceEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX_BYTES = 4 * 1024 * 1024;
  var DEFAULT_KEYS = { state: 'suike.timetable.v1', history: 'suike.history.v1', semesters: 'suike.semesters.v1', journal: 'suike.workspace.transaction.v1' };
  var EDIT_KEYS = ['name', 'day', 'start', 'end', 'room', 'teacher', 'color', 'sourceTime', 'timeMode', 'timeNote'];
  function fail(code, message, cause) {
    var error = new Error(message || code); error.code = code;
    if (cause) error.cause = cause;
    throw error;
  }
  function plain(value) { return !!value && Object.prototype.toString.call(value) === '[object Object]'; }
  function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch (e) { fail('JSON_INVALID', '数据无法安全保存', e); } }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (plain(value)) return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + stable(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function fingerprint(value) {
    var text = stable(value), a = 2166136261, b = 3339675911;
    for (var i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 2246822519); }
    function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
    return hex(a) + hex(b);
  }
  function equal(a, b) { return stable(a) === stable(b); }
  function size(value) { return JSON.stringify(value).length * 2; }
  function label(value, max, code) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(code || 'TEXT_INVALID', '名称或操作说明无效');
    return value.trim();
  }
  function dateValue(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('DATE_INVALID', '日期无效');
    var date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 2200) fail('DATE_INVALID', '日期无效');
    return date;
  }
  function dayOf(value) { return dateValue(value).getUTCDay() || 7; }
  function addDays(value, days) { var result = new Date(dateValue(value).getTime() + days * 86400000).toISOString().slice(0, 10); dateValue(result); return result; }
  function stamp(options) {
    var value = options && typeof options.now === 'function' ? options.now() : new Date().toISOString();
    if (value instanceof Date) value = value.toISOString();
    if (typeof value === 'number') value = new Date(value).toISOString();
    if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) fail('TIMESTAMP_INVALID', '保存时间无效');
    return new Date(value).toISOString();
  }
  function requireKeys(value, allowed, required, code) {
    if (!plain(value) || Object.keys(value).some(function (key) { return allowed.indexOf(key) < 0; }) || (required || allowed).some(function (key) { return !Object.prototype.hasOwnProperty.call(value, key); })) fail(code || 'DATA_INVALID');
  }
  // The default ledger guard follows JustSafeMerge v1's public schema. Passing
  // JustSafeMerge.validateLedger is preferred and retains its canonicalization.
  function guardLedger(value) {
    if (value === null) return null;
    requireKeys(value, ['version', 'source', 'entries'], null, 'LEDGER_INVALID');
    requireKeys(value.source, ['system', 'term'], null, 'LEDGER_INVALID');
    label(value.source.system, 80, 'LEDGER_INVALID'); label(value.source.term, 120, 'LEDGER_INVALID');
    if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 10000) fail('LEDGER_INVALID');
    var ids = new Set(), associations = new Set();
    value.entries.forEach(function (entry) {
      requireKeys(entry, ['sourceOccurrenceId', 'sourceKey', 'week', 'baseline', 'association', 'tombstone'], null, 'LEDGER_INVALID');
      label(entry.sourceOccurrenceId, 200, 'LEDGER_INVALID'); label(entry.sourceKey, 200, 'LEDGER_INVALID');
      if (ids.has(entry.sourceOccurrenceId) || typeof entry.tombstone !== 'boolean' || !Number.isInteger(entry.week) || entry.week < 1 || entry.week > 52) fail('LEDGER_INVALID');
      ids.add(entry.sourceOccurrenceId);
      requireKeys(entry.baseline, ['date', 'name', 'day', 'start', 'end', 'room', 'teacher', 'sourceTime', 'timeMode', 'timeNote'], null, 'LEDGER_INVALID');
      var row = entry.baseline;
      if (dayOf(row.date) !== row.day || ['periods', 'clock', 'pending'].indexOf(row.timeMode) < 0) fail('LEDGER_INVALID');
      label(row.name, 80, 'LEDGER_INVALID');
      [['room', 120], ['teacher', 120], ['sourceTime', 40], ['timeNote', 160]].forEach(function (field) {
        if (typeof row[field[0]] !== 'string' || row[field[0]].length > field[1] || /[\u0000-\u001f\u007f]/.test(row[field[0]])) fail('LEDGER_INVALID');
      });
      if (row.sourceTime && !/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.sourceTime)) fail('LEDGER_INVALID');
      if (row.sourceTime && row.sourceTime.slice(0, 5) >= row.sourceTime.slice(6)) fail('LEDGER_INVALID');
      const clockOnly=row.timeMode==='clock'&&row.start===null&&row.end===null;
      if(clockOnly?(!row.sourceTime||!!row.timeNote):(row.timeMode==='pending'?row.start!==null||row.end!==null||!row.timeNote:!Number.isInteger(row.start)||!Number.isInteger(row.end)||row.start<1||row.end<row.start||row.end>24||!!row.timeNote))fail('LEDGER_INVALID');
      if (entry.association !== null) {
        requireKeys(entry.association, ['courseId', 'date'], null, 'LEDGER_INVALID');
        label(entry.association.courseId, 160, 'LEDGER_INVALID'); dateValue(entry.association.date);
        var key = stable(entry.association);
        if (entry.tombstone || associations.has(key)) fail('LEDGER_INVALID');
        associations.add(key);
      }
    });
    var result = clone(value);
    result.entries.sort(function (a, b) { return a.sourceOccurrenceId.localeCompare(b.sourceOccurrenceId); });
    return result;
  }
  function normalizeState(input, validator, validateLedger) {
    if (typeof validator !== 'function') fail('VALIDATOR_REQUIRED', '缺少课表校验器');
    var source = clone(input), output;
    try { output = clone(validator(clone(source))); } catch (e) { if (e.code) throw e; fail('STATE_INVALID', e.message || '课表数据无效', e); }
    if (Object.prototype.hasOwnProperty.call(source, 'importLedger')) {
      try { output.importLedger = (validateLedger || guardLedger)(clone(source.importLedger)); } catch (e) { if (e.code) throw e; fail('LEDGER_INVALID', e.message || '导入记录无效', e); }
    }
    if (Object.prototype.hasOwnProperty.call(source, 'skipLegacyImportBaseline')) {
      if (typeof source.skipLegacyImportBaseline !== 'boolean') fail('LEGACY_MARKER_INVALID');
      output.skipLegacyImportBaseline = source.skipLegacyImportBaseline;
    }
    return output;
  }
  function normalized(input, options) { return normalizeState(input, options && options.validateState, options && options.validateLedger); }
  function limits(options) {
    var count = options && options.maxSnapshots === undefined ? 10 : options && options.maxSnapshots;
    var bytes = options && options.maxBytes === undefined ? MAX_BYTES : options && options.maxBytes;
    count = count == null ? 10 : count; bytes = bytes == null ? MAX_BYTES : bytes;
    if (!Number.isInteger(count) || count < 1 || count > 10 || !Number.isInteger(bytes) || bytes < 1024 || bytes > MAX_BYTES) fail('LIMIT_INVALID');
    return { count: count, bytes: bytes };
  }
  function normalizeHistory(value, options) {
    if (value === null || value === undefined) return { version: 1, snapshots: [] };
    requireKeys(value, ['version', 'snapshots'], null, 'HISTORY_INVALID');
    if (value.version !== 1 || !Array.isArray(value.snapshots) || value.snapshots.length > 10 || size(value) > MAX_BYTES) fail('HISTORY_INVALID', '历史记录无效，请先导出并检查本地数据');
    var ids = new Set();
    var result = { version: 1, snapshots: value.snapshots.map(function (item) {
      requireKeys(item, ['id', 'createdAt', 'reason', 'fingerprint', 'sizeBytes', 'state', 'semesterId'], ['id', 'createdAt', 'reason', 'fingerprint', 'sizeBytes', 'state'], 'HISTORY_INVALID');
      var state = normalized(item.state, options), expected = fingerprint(state);
      if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.createdAt !== 'string' || !Number.isFinite(new Date(item.createdAt).getTime()) || item.fingerprint !== expected || item.sizeBytes !== size(state)) fail('HISTORY_INVALID', '历史记录校验失败');
      ids.add(item.id);
      var entry = { id: item.id, createdAt: item.createdAt, reason: label(item.reason, 160, 'HISTORY_INVALID'), fingerprint: expected, sizeBytes: size(state), state: state };
      if (item.semesterId !== undefined) { if (item.semesterId !== null) label(item.semesterId, 160, 'HISTORY_INVALID'); entry.semesterId = item.semesterId; }
      return entry;
    }) };
    return result;
  }
  function prepareHistory(history, current, next, reason, options) {
    var before = normalized(current, options), after = next == null ? null : normalized(next, options);
    var value = normalizeHistory(history, options), limit = limits(options);
    if (after && equal(before, after)) return { history: value, changed: false, snapshot: null };
    var hash = fingerprint(before), last = value.snapshots[value.snapshots.length - 1];
    if (last && equal(last.state, before) && last.semesterId === (options && options.semesterId)) return { history: value, changed: false, snapshot: clone(last) };
    var at = stamp(options), id = 'snapshot-' + at.replace(/[^0-9]/g, '') + '-' + hash;
    var occupied = new Set(value.snapshots.map(function (item) { return item.id; })), suffix = 2;
    while (occupied.has(id)) { id = 'snapshot-' + at.replace(/[^0-9]/g, '') + '-' + hash + '-' + suffix; suffix++; }
    var item = { id: id, createdAt: at, reason: label(reason || '修改课表', 160, 'REASON_INVALID'), fingerprint: hash, sizeBytes: size(before), state: before };
    if (options && options.semesterId !== undefined) { if (options.semesterId !== null) label(options.semesterId, 160, 'SEMESTER_ID_INVALID'); item.semesterId = options.semesterId; }
    value.snapshots.push(item);
    while (value.snapshots.length > limit.count || (size(value) > limit.bytes && value.snapshots.length > 1)) value.snapshots.shift();
    if (size(value) > limit.bytes) fail('HISTORY_STATE_TOO_LARGE', '当前课表超过历史记录容量，未修改课表');
    return { history: value, changed: true, snapshot: clone(item) };
  }
  function storageRead(storage, key, code) {
    var raw;
    try { raw = storage.getItem(key); } catch (e) { fail('STORAGE_READ_FAILED', '无法读取本地数据，未修改课表', e); }
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string' || raw.length * 2 > MAX_BYTES * 4) fail(code || 'STORAGE_DATA_INVALID');
    try { return JSON.parse(raw); } catch (e) { fail(code || 'STORAGE_DATA_INVALID', '本地记录损坏，未修改课表', e); }
  }
  function storageWrite(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (e) { if (e && e.code === 'CHECKPOINT_WRITE_FAILED') throw e; fail('STORAGE_WRITE_FAILED', '本地空间不足或无法保存，未修改课表', e); }
  }
  function ensureStorage(storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') fail('STORAGE_REQUIRED');
  }
  function createHistory(options) {
    options = options || {}; ensureStorage(options.storage); limits(options);
    var storage = options.storage, key = options.key || DEFAULT_KEYS.history;
    function read() { return normalizeHistory(storageRead(storage, key, 'HISTORY_INVALID'), options); }
    return {
      captureBefore: function (current, next, reason, metadata) {
        if (metadata !== undefined) requireKeys(metadata, ['semesterId'], [], 'HISTORY_METADATA_INVALID');
        var result = prepareHistory(read(), current, next, reason, Object.assign({}, options, metadata || {}));
        if (result.changed) storageWrite(storage, key, result.history);
        return result;
      },
      list: function () { return read().snapshots.slice().reverse().map(function (item) { return { id: item.id, createdAt: item.createdAt, reason: item.reason, fingerprint: item.fingerprint, sizeBytes: item.sizeBytes }; }); },
      get: function (id) {
        var item = read().snapshots.filter(function (entry) { return entry.id === id; })[0];
        if (!item) fail('SNAPSHOT_NOT_FOUND', '此历史记录已不存在');
        return clone(item);
      },
      restore: function (id) { return this.get(id).state; }
    };
  }
  function normalizeArchive(input, options) {
    if (input === null || input === undefined) return { version: 1, activeId: null, semesters: [] };
    requireKeys(input, ['version', 'activeId', 'semesters'], null, 'SEMESTER_ARCHIVE_INVALID');
    if (input.version !== 1 || !Array.isArray(input.semesters) || input.semesters.length > 12 || size(input) > MAX_BYTES) fail('SEMESTER_ARCHIVE_INVALID', '学期存档无效或超过容量');
    var ids = new Set(), result = { version: 1, activeId: input.activeId, semesters: input.semesters.map(function (entry) {
      requireKeys(entry, ['id', 'name', 'updatedAt', 'state'], null, 'SEMESTER_ARCHIVE_INVALID');
      var id = label(entry.id, 160, 'SEMESTER_ARCHIVE_INVALID');
      if (ids.has(id) || typeof entry.updatedAt !== 'string' || !Number.isFinite(new Date(entry.updatedAt).getTime())) fail('SEMESTER_ARCHIVE_INVALID');
      ids.add(id);
      return { id: id, name: label(entry.name, 120, 'SEMESTER_ARCHIVE_INVALID'), updatedAt: entry.updatedAt, state: normalized(entry.state, options) };
    }) };
    if (result.activeId !== null && (typeof result.activeId !== 'string' || !ids.has(result.activeId))) fail('SEMESTER_ARCHIVE_INVALID');
    return result;
  }
  function semesterId(state, archive, at) {
    var base = 'semester-' + fingerprint([state.settings.startMonday, state.settings.termLabel, at]), id = base, suffix = 2;
    while (archive.semesters.some(function (entry) { return entry.id === id; })) { id = base + '-' + suffix; suffix++; }
    return id;
  }
  function saveCurrentSemester(current, archive, options) {
    var state = normalized(current, options), result = normalizeArchive(archive, options), at = stamp(options);
    var entry = result.semesters.filter(function (item) { return item.id === result.activeId; })[0];
    if (!entry) { entry = { id: semesterId(state, result, at) }; result.semesters.push(entry); result.activeId = entry.id; }
    entry.name = state.settings.termLabel; entry.updatedAt = at; entry.state = state;
    checkArchiveSize(result);
    return result;
  }
  function checkArchiveSize(archive) {
    if (archive.semesters.length > 12) fail('SEMESTER_LIMIT', '最多保留 12 个学期，请先导出需要移出的学期');
    if (size(archive) > MAX_BYTES) fail('SEMESTER_ARCHIVE_FULL', '学期存档容量已满，未切换学期');
  }
  function planCreateSemester(current, archive, config, options) {
    var before = normalized(current, options), saved = saveCurrentSemester(before, archive, options);
    if (!plain(config) || dayOf(config.startMonday) !== 1) fail('SEMESTER_MONDAY_REQUIRED', '新学期的第一周开始日期必须为周一');
    if (!Array.isArray(config.periods)) fail('SEMESTER_PERIODS_REQUIRED', '请填写新学期课时');
    var settings = { startMonday: config.startMonday, totalWeeks: config.totalWeeks === undefined ? before.settings.totalWeeks : config.totalWeeks,
      termLabel: label(config.termLabel, 120, 'SEMESTER_NAME_REQUIRED'), coverageStart: null, coverageEnd: null, theme: before.settings.theme };
    var raw = { schemaVersion: 1, settings: settings, periods: clone(config.periods), courses: [], appliedUpdateIds: [], importLedger: null, skipLegacyImportBaseline: true };
    if (before.productSettings !== undefined || config.productSettings !== undefined) {
      raw.productSettings = clone(config.productSettings === undefined ? before.productSettings : config.productSettings);
      if (raw.productSettings && raw.productSettings.reminders) { raw.productSettings.reminders.mutedCourseIds = []; raw.productSettings.reminders.courseOverrides = {}; }
    }
    var state = normalized(raw, options), at = stamp(options), id = semesterId(state, saved, at), previousActiveId = saved.activeId;
    saved.semesters.push({ id: id, name: state.settings.termLabel, updatedAt: at, state: clone(state) }); saved.activeId = id;
    checkArchiveSize(saved);
    return { state: state, archive: saved, activeId: id, previousActiveId: previousActiveId };
  }
  function planSwitchSemester(current, archive, id, options) {
    var saved = saveCurrentSemester(current, archive, options), target = saved.semesters.filter(function (entry) { return entry.id === id; })[0];
    if (!target) fail('SEMESTER_NOT_FOUND', '此学期已不存在');
    var previousActiveId = saved.activeId; saved.activeId = id;
    return { state: clone(target.state), archive: saved, activeId: id, previousActiveId: previousActiveId };
  }
  function createWorkspaceStore(options) {
    options = options || {}; ensureStorage(options.storage);
    var storage = options.storage, stateKey = options.stateKey || DEFAULT_KEYS.state, archiveKey = options.semesterKey || DEFAULT_KEYS.semesters;
    var historyKey = options.historyKey || DEFAULT_KEYS.history, journalKey = options.journalKey || DEFAULT_KEYS.journal;
    if (new Set([stateKey, archiveKey, historyKey, journalKey]).size !== 4) fail('STORAGE_KEYS_OVERLAP');
    var history = createHistory(Object.assign({}, options, { key: historyKey }));
    function rollback(writes) {
      var failed = false;
      writes.slice().reverse().forEach(function (entry) { try { if (entry.previous === null) storage.removeItem(entry.key); else storage.setItem(entry.key, entry.previous); } catch (_) { failed = true; } });
      return failed;
    }
    function recover() {
      var journal = storageRead(storage, journalKey, 'TRANSACTION_INVALID');
      if (journal === null) return false;
      requireKeys(journal, ['version', 'writes'], null, 'TRANSACTION_INVALID');
      if (journal.version !== 1 || !Array.isArray(journal.writes) || journal.writes.length !== 2) fail('TRANSACTION_INVALID');
      var seen = new Set();
      journal.writes.forEach(function (entry) {
        requireKeys(entry, ['key', 'previous'], null, 'TRANSACTION_INVALID');
        if ([archiveKey, stateKey].indexOf(entry.key) < 0 || seen.has(entry.key) || (entry.previous !== null && typeof entry.previous !== 'string')) fail('TRANSACTION_INVALID');
        seen.add(entry.key);
      });
      if (rollback(journal.writes)) fail('TRANSACTION_RECOVERY_FAILED', '上次保存未完成，请重新打开后检查本地数据');
      try { storage.removeItem(journalKey); } catch (e) { fail('TRANSACTION_RECOVERY_FAILED', '无法完成上次保存的恢复', e); }
      return true;
    }
    function transaction(archive, state) {
      var writes;
      try { writes = [{ key: archiveKey, previous: storage.getItem(archiveKey) }, { key: stateKey, previous: storage.getItem(stateKey) }]; } catch (e) { fail('STORAGE_READ_FAILED', '无法读取本地数据，未切换学期', e); }
      writes.forEach(function (entry) { if (entry.previous === undefined) entry.previous = null; });
      storageWrite(storage, journalKey, { version: 1, writes: writes });
      try {
        storageWrite(storage, archiveKey, archive); storageWrite(storage, stateKey, state);
        try { storage.removeItem(journalKey); } catch (cleanupError) { fail('STORAGE_WRITE_FAILED', '无法完成本地保存，未切换学期', cleanupError); }
      } catch (e) {
        var failed = rollback(writes);
        if (!failed) { try { storage.removeItem(journalKey); } catch (_) { failed = true; } }
        e.rollbackFailed = failed;
        if (failed) e.message = '保存失败且尚未完成恢复，请重新打开后检查本地数据';
        throw e;
      }
    }
    function archiveRead() { recover(); return normalizeArchive(storageRead(storage, archiveKey, 'SEMESTER_ARCHIVE_INVALID'), options); }
    function commit(current, next, reason) {
      recover(); var before = normalized(current, options), after = normalized(next, options);
      if (equal(before, after)) return { state: after, changed: false };
      var archive = archiveRead();
      history.captureBefore(before, after, reason, { semesterId: archive.activeId }); storageWrite(storage, stateKey, after);
      return { state: after, changed: true };
    }
    function applySemester(current, plan, reason) {
      history.captureBefore(current, plan.state, reason, { semesterId: plan.previousActiveId }); transaction(plan.archive, plan.state);
      return { state: clone(plan.state), changed: !equal(normalized(current, options), plan.state), activeId: plan.activeId };
    }
    return {
      commit: commit, recover: recover,
      listHistory: function () { recover(); return history.list(); },
      restoreHistory: function (current, id, reason) {
        recover(); var item = history.get(id), archive = archiveRead();
        if (item.semesterId && archive.semesters.some(function (entry) { return entry.id === item.semesterId; })) {
          var saved = saveCurrentSemester(current, archive, options), previousActiveId = saved.activeId;
          var target = saved.semesters.filter(function (entry) { return entry.id === item.semesterId; })[0];
          target.state = clone(item.state); target.name = item.state.settings.termLabel; target.updatedAt = stamp(options); saved.activeId = item.semesterId;
          checkArchiveSize(saved);
          return applySemester(current, { state: item.state, archive: saved, activeId: item.semesterId, previousActiveId: previousActiveId }, reason || '恢复历史记录');
        }
        return commit(current, item.state, reason || '恢复历史记录');
      },
      listSemesters: function () { var value = archiveRead(); return value.semesters.map(function (entry) { return { id: entry.id, name: entry.name, updatedAt: entry.updatedAt, active: entry.id === value.activeId, courseCount: entry.state.courses.length }; }); },
      createSemester: function (current, config) { var plan = planCreateSemester(current, archiveRead(), config, options); return applySemester(current, plan, '创建学期：' + plan.state.settings.termLabel); },
      switchSemester: function (current, id) { var plan = planSwitchSemester(current, archiveRead(), id, options); return applySemester(current, plan, '切换学期：' + plan.state.settings.termLabel); },
      saveSemester: function (current) { var saved = saveCurrentSemester(current, archiveRead(), options); transaction(saved, normalized(current, options)); return { state: normalized(current, options), changed: false, activeId: saved.activeId }; }
    };
  }
  function selectOccurrences(state, request) {
    if (!plain(request) || ['one', 'future', 'all'].indexOf(request.scope) < 0) fail('OCCURRENCE_SCOPE_INVALID', '请选择仅本次、本次及以后或全部');
    var course = state.courses.filter(function (entry) { return entry.id === request.courseId; })[0];
    if (!course || course.dates.indexOf(request.date) < 0) fail('OCCURRENCE_NOT_FOUND', '此课程或上课日期已不存在');
    return { course: course, dates: course.dates.filter(function (date) { return request.scope === 'all' || (request.scope === 'future' ? date >= request.date : date === request.date); }) };
  }
  function associationKey(id, date) { return JSON.stringify([id, date]); }
  function remapLedger(state, mappings) {
    if (!state.importLedger) return;
    state.importLedger.entries.forEach(function (entry) {
      if (!entry.association) return;
      var key = associationKey(entry.association.courseId, entry.association.date);
      if (!Object.prototype.hasOwnProperty.call(mappings, key)) return;
      entry.association = mappings[key] === null ? null : clone(mappings[key]);
      entry.tombstone = mappings[key] === null;
    });
  }
  function deterministicEditId(course, dates, changes, delta, existing) {
    var base = course.id.slice(0, 120) + '-edit-' + fingerprint([course.id, dates, changes, delta]), id = base, suffix = 2;
    while (existing.some(function (entry) { return entry.id === id; })) { id = base + '-' + suffix; suffix++; }
    return id;
  }
  function actualTime(course, periods) {
    if (course.timeMode === 'pending') return { confirmed: false, reason: 'PENDING_TIME' };
    var source = course.sourceTime;
    if(course.end>8&&!(periods&&periods[course.end-1])&&!source)return {confirmed:false,reason:'NIGHT_TIME_MISSING'};
    if ((course.timeMode==='clock'||(!(periods&&periods[course.start-1]&&periods[course.end-1])&&course.end>8))&&source) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(source) || source.slice(0, 5) >= source.slice(6)) return { confirmed: false, reason: 'SOURCE_TIME_INVALID' };
      return { confirmed: true, start: source.slice(0, 5), end: source.slice(6), source: 'sourceTime' };
    }
    var first = periods && periods[course.start - 1], last = periods && periods[course.end - 1];
    if (!first || !last || typeof first.start !== 'string' || typeof last.end !== 'string' || first.start >= last.end) return { confirmed: false, reason: 'PERIOD_TIME_MISSING' };
    return { confirmed: true, start: first.start, end: last.end, source: 'periods' };
  }
  function actualIntervals(course,periods){
    var t=actualTime(course,periods);if(!t.confirmed)return [];
    var first=periods[course.start-1],last=periods[course.end-1];
    if(course.timeMode==='clock'||!first||!last)return [t];
    return periods.slice(course.start-1,course.end).map(function(p){return {start:p.start,end:p.end};});
  }
  function detectConflicts(state, candidate, options) {
    options = options || {};
    if (!candidate || !Array.isArray(candidate.dates)) fail('COURSE_INVALID');
    var ignored = new Set((options.ignoreOccurrences || []).map(function (entry) { return associationKey(entry.courseId, entry.date); }));
    var range = actualTime(candidate, state.periods), conflicts = [], unconfirmed = [], dates = new Set(candidate.dates);
    if (!range.confirmed) candidate.dates.forEach(function (date) { unconfirmed.push({ courseId: candidate.id, name: candidate.name, date: date, reason: 'CANDIDATE_TIME_UNCONFIRMED', detail: range.reason }); });
    state.courses.forEach(function (other) {
      var otherRange = actualTime(other, state.periods);
      other.dates.forEach(function (date) {
        if (!dates.has(date) || ignored.has(associationKey(other.id, date))) return;
        if (!otherRange.confirmed) { unconfirmed.push({ courseId: other.id, name: other.name, date: date, reason: 'OTHER_TIME_UNCONFIRMED', detail: otherRange.reason }); return; }
        if (range.confirmed && actualIntervals(candidate,state.periods).some(function(a){return actualIntervals(other,state.periods).some(function(b){return a.start<b.end&&b.start<a.end;});})) conflicts.push({ courseId: other.id, name: other.name, room: other.room, date: date, start: otherRange.start, end: otherRange.end, candidateStart: range.start, candidateEnd: range.end, reason: 'TIME_OVERLAP' });
      });
    });
    return { status: conflicts.length ? 'conflict' : unconfirmed.length ? 'unconfirmed' : 'clear', conflicts: conflicts, unconfirmed: unconfirmed };
  }
  function editOccurrences(input, request, options) {
    var state = normalized(input, options), selected = selectOccurrences(state, request), course = selected.course;
    var changes = request.changes || {};
    requireKeys(changes, EDIT_KEYS, [], 'COURSE_EDIT_INVALID');
    var delta = 0;
    if (request.targetDate !== undefined) {
      delta = Math.round((dateValue(request.targetDate) - dateValue(request.date)) / 86400000);
      if (changes.day !== undefined && changes.day !== dayOf(request.targetDate)) fail('DAY_DATE_MISMATCH', '目标日期与星期不一致');
    } else if (changes.day !== undefined) {
      if (!Number.isInteger(changes.day) || changes.day < 1 || changes.day > 7) fail('DAY_INVALID');
      delta = changes.day - course.day;
    }
    var selectedSet = new Set(selected.dates), remaining = course.dates.filter(function (date) { return !selectedSet.has(date); });
    var edited = Object.assign({}, course, clone(changes));
    edited.dates = selected.dates.map(function (date) { return addDays(date, delta); });
    edited.day = dayOf(edited.dates[0]);
    edited = normalized(Object.assign({}, state, { courses: [edited], importLedger: null }), options).courses[0];
    var equivalent = Object.assign({}, edited, { dates: course.dates });
    if (delta === 0 && equal(equivalent, course)) return { state: state, affected: 0, courseId: course.id, originalDates: [], dates: [], associations: {}, conflicts: [], unconfirmed: [], conflictStatus: 'clear' };
    if (edited.dates.some(function (date) { return remaining.indexOf(date) >= 0; })) fail('OCCURRENCE_DATE_COLLISION', '目标日期与这门课保留的日期重复');
    edited.id = remaining.length ? deterministicEditId(course, selected.dates, changes, delta, state.courses) : course.id;
    var check = detectConflicts(state, edited, { ignoreOccurrences: selected.dates.map(function (date) { return { courseId: course.id, date: date }; }) });
    var index = state.courses.indexOf(course);
    if (remaining.length) { course.dates = remaining; state.courses.splice(index + 1, 0, edited); } else state.courses[index] = edited;
    var mappings = {};
    selected.dates.forEach(function (date, i) { mappings[associationKey(course.id, date)] = { courseId: edited.id, date: edited.dates[i] }; });
    remapLedger(state, mappings);
    // Splitting a series must not silently re-enable a muted occurrence or lose
    // that course's lead-time override. Both series inherit the original rule.
    var reminders = state.productSettings && state.productSettings.reminders;
    if (remaining.length && edited.id !== course.id && reminders) {
      if (Array.isArray(reminders.mutedCourseIds) && reminders.mutedCourseIds.indexOf(course.id) >= 0 && reminders.mutedCourseIds.indexOf(edited.id) < 0) {
        if (reminders.mutedCourseIds.length >= 500) fail('REMINDER_LIMIT', '课程提醒例外已达 500 项，未修改课程');
        reminders.mutedCourseIds.push(edited.id);
      }
      if (plain(reminders.courseOverrides) && Object.prototype.hasOwnProperty.call(reminders.courseOverrides, course.id)) {
        if (!Object.prototype.hasOwnProperty.call(reminders.courseOverrides, edited.id) && Object.keys(reminders.courseOverrides).length >= 500) fail('REMINDER_LIMIT', '课程提醒例外已达 500 项，未修改课程');
        reminders.courseOverrides[edited.id] = clone(reminders.courseOverrides[course.id]);
      }
    }
    state = normalized(state, options);
    return { state: state, affected: selected.dates.length, courseId: edited.id, originalDates: selected.dates, dates: edited.dates, associations: clone(mappings), conflicts: check.conflicts, unconfirmed: check.unconfirmed, conflictStatus: check.status };
  }
  function removeOccurrences(input, request, options) {
    var state = normalized(input, options), selected = selectOccurrences(state, request), selectedSet = new Set(selected.dates), mappings = {};
    state.courses = state.courses.reduce(function (courses, course) {
      if (course.id === selected.course.id) { course.dates = course.dates.filter(function (date) { return !selectedSet.has(date); }); if (!course.dates.length) return courses; }
      courses.push(course); return courses;
    }, []);
    selected.dates.forEach(function (date) { mappings[associationKey(selected.course.id, date)] = null; }); remapLedger(state, mappings);
    return { state: normalized(state, options), affected: selected.dates.length, originalDates: selected.dates, associations: clone(mappings) };
  }
  return { DEFAULT_KEYS: DEFAULT_KEYS, MAX_BYTES: MAX_BYTES, fingerprint: fingerprint, normalizeState: normalizeState, normalizeHistory: normalizeHistory, prepareHistory: prepareHistory, createHistory: createHistory,
    normalizeArchive: normalizeArchive, saveCurrentSemester: saveCurrentSemester, planCreateSemester: planCreateSemester, planSwitchSemester: planSwitchSemester, createWorkspaceStore: createWorkspaceStore,
    editOccurrences: editOccurrences, removeOccurrences: removeOccurrences, actualTime: actualTime, detectConflicts: detectConflicts };
});
