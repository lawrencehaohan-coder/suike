/* Pure import planning. No network, DOM, storage or page code execution. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../timetable/dist/model.js'));
  else root.JustSafeMerge = factory(root.TimetableModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  var MAX_ENTRIES = 10000;
  var SNAPSHOT_KEYS = ['date', 'name', 'day', 'start', 'end', 'room', 'teacher', 'sourceTime', 'timeMode', 'timeNote'];
  function fail(code) { var e = new TypeError(code); e.code = code; throw e; }
  function plain(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    var proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
  }
  function keys(value, allowed, required) {
    if (!plain(value)) fail('OBJECT_REQUIRED');
    var own = Object.keys(value);
    if (own.some(function (key) { return allowed.indexOf(key) < 0; })) fail('UNKNOWN_FIELD');
    if ((required || allowed).some(function (key) { return !Object.prototype.hasOwnProperty.call(value, key); })) fail('REQUIRED_FIELD');
    if (own.some(function (key) { var d = Object.getOwnPropertyDescriptor(value, key); return !d || !Object.prototype.hasOwnProperty.call(d, 'value'); })) fail('ACCESSOR_NOT_ALLOWED');
  }
  function str(value, max, allowEmpty) {
    if (typeof value !== 'string' || value.length > max || value !== value.trim() || (!allowEmpty && !value) || /[\u0000-\u001f\u007f]/.test(value)) fail('STRING_INVALID');
    return value;
  }
  function date(value) { if (!M.parseISO(value)) fail('DATE_INVALID'); return value; }
  function source(value) {
    keys(value, ['system', 'term']);
    return { system: str(value.system, 80, false), term: str(value.term, 120, false) };
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function array(value, max) {
    if (!Array.isArray(value) || value.length > max) fail('ARRAY_INVALID');
    for (var i = 0; i < value.length; i++) if (!Object.prototype.hasOwnProperty.call(value, i)) fail('SPARSE_ARRAY_INVALID');
    if (Object.keys(value).some(function (key) { return !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length; })) fail('ARRAY_FIELD_INVALID');
    return value;
  }
  function snapshot(value, strict, system) {
    keys(value, SNAPSHOT_KEYS, strict ? SNAPSHOT_KEYS : ['date', 'name', 'day', 'start', 'end', 'room', 'teacher', 'sourceTime']);
    var mode = value.timeMode === undefined ? 'periods' : value.timeMode;
    if (mode !== 'periods' && mode !== 'clock' && mode !== 'pending') fail('TIME_MODE_INVALID');
    var result = { date: date(value.date), name: str(value.name, 80, false), day: value.day,
      start: value.start, end: value.end, room: str(value.room, 120, true), teacher: str(value.teacher, 120, true),
      sourceTime: str(value.sourceTime, 40, true), timeMode: mode, timeNote: value.timeNote === undefined ? '' : str(value.timeNote, 160, true) };
    if (M.dayOf(result.date) !== result.day) fail('DAY_DATE_MISMATCH');
    if (mode === 'pending') {
      if (result.start !== null || result.end !== null || !result.timeNote) fail('PENDING_TIME_INVALID');
    } else if(mode==='clock'&&result.start===null&&result.end===null){
      if(!result.sourceTime||result.timeNote)fail('CLOCK_TIME_REQUIRED');
    } else {
      if (!Number.isInteger(result.start) || !Number.isInteger(result.end) || result.start < 1 || result.end < result.start || result.end > 24 || result.timeNote) fail('PERIODS_INVALID');
      if (mode==='clock'&&!result.sourceTime) fail('CLOCK_TIME_REQUIRED');
      if(result.end>8&&!result.sourceTime)fail('NIGHT_TIME_REQUIRED');
    }
    var normalizedTime;
    try { normalizedTime = M.normalizeSourceTime(result.sourceTime); } catch (_) { fail('SOURCE_TIME_INVALID'); }
    if (normalizedTime !== result.sourceTime) fail('SOURCE_TIME_NOT_CANONICAL');
    // The actual daytime clock is defined by personal periods. The old portal
    // recorded a different daytime source clock, which must not become a
    // fictitious schedule change. Keep course storage untouched; normalize only
    // comparison/baseline snapshots.
    if (mode === 'periods' && result.end <= 8) result.sourceTime = '';
    // The observed teaching table prefixes rooms with the explicit campus name;
    // the old portal stores the same building/room without that prefix.
    if(system==='just-jwglxt')result.room = result.room.replace(/^张家港 +(?=\S)/, '');
    return result;
  }
  function localSnapshot(course, occurrenceDate, system) {
    return snapshot({ date: occurrenceDate, name: course.name, day: course.day, start: course.start, end: course.end,
      room: course.room, teacher: course.teacher, sourceTime: course.sourceTime || '',
      timeMode: course.timeMode || 'periods', timeNote: course.timeNote || '' }, true, system);
  }
  function associationKey(a) { return JSON.stringify([a.courseId, a.date]); }
  function validateLedger(value) {
    if (value === undefined || value === null) return null;
    keys(value, ['version', 'source', 'entries']);
    if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) fail('LEDGER_INVALID');
    array(value.entries, MAX_ENTRIES);
    var ids = new Set(), associations = new Set();
    var entries = value.entries.map(function (entry) {
      keys(entry, ['sourceOccurrenceId', 'sourceKey', 'week', 'baseline', 'association', 'tombstone']);
      var id = str(entry.sourceOccurrenceId, 200, false);
      if (ids.has(id)) fail('DUPLICATE_SOURCE_ID');
      ids.add(id);
      if (typeof entry.tombstone !== 'boolean') fail('TOMBSTONE_INVALID');
      var association = null;
      if (entry.association !== null) {
        keys(entry.association, ['courseId', 'date']);
        association = { courseId: str(entry.association.courseId, 160, false), date: date(entry.association.date) };
        var key = associationKey(association);
        if (associations.has(key)) fail('DUPLICATE_LOCAL_ASSOCIATION');
        associations.add(key);
      }
      if (entry.tombstone && association !== null) fail('TOMBSTONE_HAS_ASSOCIATION');
      if (!Number.isInteger(entry.week) || entry.week < 1 || entry.week > 52) fail('WEEK_INVALID');
      return { sourceOccurrenceId: id, sourceKey: str(entry.sourceKey, 200, false), week: entry.week,
        baseline: snapshot(entry.baseline, true, value.source.system), association: association, tombstone: entry.tombstone };
    });
    entries.sort(function (a, b) { return a.sourceOccurrenceId.localeCompare(b.sourceOccurrenceId); });
    return { version: 1, source: source(value.source), entries: entries };
  }
  function parseLedger(json) {
    if (typeof json !== 'string' || json.length > 5 * 1024 * 1024) fail('LEDGER_JSON_INVALID');
    var value;
    try { value = JSON.parse(json); } catch (_) { fail('LEDGER_JSON_INVALID'); }
    return validateLedger(value);
  }
  function normalizeIncoming(value) {
    keys(value, ['source', 'scope', 'occurrences', 'rejectedCount'], ['source', 'scope', 'occurrences']);
    keys(value.scope, ['from', 'to', 'complete']);
    var scope = { from: date(value.scope.from), to: date(value.scope.to), complete: value.scope.complete };
    if (scope.from > scope.to || typeof scope.complete !== 'boolean' || !Array.isArray(value.occurrences) || value.occurrences.length > MAX_ENTRIES) fail('INCOMING_INVALID');
    array(value.occurrences, MAX_ENTRIES);
    var externalRejected = value.rejectedCount === undefined ? 0 : value.rejectedCount;
    if (!Number.isInteger(externalRejected) || externalRejected < 0 || externalRejected > MAX_ENTRIES) fail('REJECTED_COUNT_INVALID');
    var groups = new Map(), invalid = [], duplicates = 0;
    value.occurrences.forEach(function (row, index) {
      var id, snap;
      try {
        keys(row, ['sourceOccurrenceId', 'sourceKey', 'week'].concat(SNAPSHOT_KEYS), ['sourceOccurrenceId', 'sourceKey', 'week', 'date', 'name', 'day', 'start', 'end', 'room', 'teacher', 'sourceTime']);
        id = str(row.sourceOccurrenceId, 200, false);
        str(row.sourceKey, 200, false);
        if (!Number.isInteger(row.week) || row.week < 1 || row.week > 52) fail('WEEK_INVALID');
        var fields = {};
        SNAPSHOT_KEYS.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(row, key)) fields[key] = row[key]; });
        snap = snapshot(fields, false, value.source.system);
        if (snap.date < scope.from || snap.date > scope.to) fail('DATE_OUTSIDE_SCOPE');
      } catch (e) { invalid.push({ type: 'invalid', reason: row && !row.sourceOccurrenceId ? 'MISSING_SOURCE_OCCURRENCE_ID' : e.code || 'OCCURRENCE_INVALID', rowIndex: index }); return; }
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push({ sourceOccurrenceId: id, sourceKey: row.sourceKey, week: row.week, snapshot: snap, rowIndex: index });
    });
    var occurrences = [];
    groups.forEach(function (rows, id) {
      if (rows.some(function (row) { return !same(row.snapshot, rows[0].snapshot) || row.sourceKey !== rows[0].sourceKey || row.week !== rows[0].week; })) {
        invalid.push({ type: 'invalid', reason: 'SOURCE_ID_VARIANTS', sourceOccurrenceId: id, rowIndices: rows.map(function (row) { return row.rowIndex; }) });
        return;
      }
      duplicates += rows.length - 1; occurrences.push(rows[0]);
    });
    occurrences.sort(function (a, b) { return a.sourceOccurrenceId.localeCompare(b.sourceOccurrenceId); });
    if (invalid.length || externalRejected) scope.complete = false;
    return { source: source(value.source), scope: scope, occurrences: occurrences, invalid: invalid, rejectedCount: externalRejected, duplicateRows: duplicates };
  }
  function changes(a, b) { return SNAPSHOT_KEYS.filter(function (key) { return a[key] !== b[key]; }); }
  function hash(value) {
    var a = 2166136261, b = 3339675911;
    for (var i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b ^ value.charCodeAt(i), 2246822519); }
    function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
    return hex(a) + hex(b);
  }
  function patternKey(a) { return JSON.stringify([a.date, a.name, a.day, a.start, a.end, a.timeMode, a.timeNote]); }
  function prepare(currentState, incoming, ledgerInput, options) {
    if (!M || typeof M.validateState !== 'function') fail('MODEL_REQUIRED');
    var state = M.validateState(currentState), input = normalizeIncoming(incoming);
    var ledger = ledgerInput == null ? { version: 1, source: input.source, entries: [] } : validateLedger(ledgerInput);
    if (!same(ledger.source, input.source)) fail('LEDGER_SOURCE_MISMATCH');
    if (options === undefined) options = {};
    keys(options, ['trustedLegacyBaseline'], []);
    var entries = new Map(), locals = new Map(), reserved = new Set(), localRows = [], preview = [], proposed = [], legacyRows = [], legacyBindings = new Set();
    var legacyByPattern = new Map(), incomingPatternCounts = new Map(), incomingSnapshotCounts = new Map();
    if (options.trustedLegacyBaseline !== undefined) {
      var legacy = M.validateState(options.trustedLegacyBaseline);
      legacy.courses.forEach(function (course) { course.dates.forEach(function (d) { legacyRows.push({ association: { courseId: course.id, date: d }, snapshot: localSnapshot(course, d, input.source.system) }); }); });
      legacyRows.forEach(function (row) { var key = patternKey(row.snapshot); if (!legacyByPattern.has(key)) legacyByPattern.set(key, []); legacyByPattern.get(key).push(row); });
    }
    input.occurrences.forEach(function (row) {
      var key = patternKey(row.snapshot), exactKey = JSON.stringify(row.snapshot);
      incomingPatternCounts.set(key, (incomingPatternCounts.get(key) || 0) + 1);
      incomingSnapshotCounts.set(exactKey, (incomingSnapshotCounts.get(exactKey) || 0) + 1);
    });
    state.courses.forEach(function (course) {
      course.dates.forEach(function (d) {
        var a = { courseId: course.id, date: d }, row = { association: a, course: course, snapshot: localSnapshot(course, d, input.source.system) };
        locals.set(associationKey(a), row); localRows.push(row);
      });
    });
    ledger.entries.forEach(function (original) {
      var entry = { sourceOccurrenceId: original.sourceOccurrenceId, sourceKey: original.sourceKey, week: original.week,
        baseline: original.baseline, association: original.association, tombstone: original.tombstone };
      if (entry.association && !locals.has(associationKey(entry.association))) { entry.association = null; entry.tombstone = true; }
      if (entry.association) reserved.add(associationKey(entry.association));
      entries.set(entry.sourceOccurrenceId, entry); proposed.push(entry);
    });
    // An app-bundled, trusted old source baseline can identify edits/deletions
    // during the first upgrade. Never use the current state itself as this proof.
    input.occurrences.forEach(function (occurrence) {
      if (entries.has(occurrence.sourceOccurrenceId)) return;
      var legacyKey = patternKey(occurrence.snapshot), matches = legacyByPattern.get(legacyKey) || [];
      if (matches.length !== 1 || reserved.has(associationKey(matches[0].association))) return;
      if (incomingPatternCounts.get(legacyKey) !== 1) return;
      var a = matches[0].association, present = locals.has(associationKey(a));
      var e = { sourceOccurrenceId: occurrence.sourceOccurrenceId, sourceKey: occurrence.sourceKey, week: occurrence.week,
        baseline: matches[0].snapshot, association: present ? a : null, tombstone: !present };
      entries.set(e.sourceOccurrenceId, e); proposed.push(e);
      legacyBindings.add(e.sourceOccurrenceId);
      if (present) reserved.add(associationKey(a));
    });
    input.occurrences.forEach(function (occurrence) {
      var id = occurrence.sourceOccurrenceId, remote = occurrence.snapshot, entry = entries.get(id);
      var item = { sourceOccurrenceId: id, sourceKey: occurrence.sourceKey, week: occurrence.week, incoming: remote, type: '', allowedActions: [] };
      if (legacyBindings.has(id)) item.bindingOrigin = 'trustedLegacy';
      if (entry) {
        item.baseline = entry.baseline; item.association = entry.association;
        if (entry.sourceKey !== occurrence.sourceKey || entry.week !== occurrence.week) {
          item.type = 'conflict'; item.reason = 'SOURCE_KEY_REUSED'; item.allowedActions = ['skip']; preview.push(item); return;
        }
        if (entry.tombstone) { item.type = 'deletedLocally'; item.reason = 'LOCAL_DELETION_PROTECTED'; }
        else if (!entry.association) { item.type = 'conflict'; item.reason = 'UNBOUND_LEDGER_ENTRY'; item.allowedActions = ['skip']; }
        else {
          var local = locals.get(associationKey(entry.association)).snapshot;
          item.local = local; item.localChanges = changes(entry.baseline, local); item.sourceChanges = changes(entry.baseline, remote);
          if (same(local, remote)) item.type = item.sourceChanges.length ? 'converged' : 'unchanged';
          else if (!item.sourceChanges.length) { item.type = 'protectedLocal'; item.reason = 'LOCAL_EDIT_PROTECTED'; }
          else if (!item.localChanges.length && item.sourceChanges.every(function (key) { return key === 'room' || key === 'teacher'; })) { item.type = 'sourceUpdate'; item.allowedActions = ['acceptSource', 'keepLocal', 'skip']; }
          else { item.type = 'conflict'; item.reason = item.localChanges.length ? 'LOCAL_AND_SOURCE_CHANGED' : 'SOURCE_SCHEDULE_CHANGED'; item.allowedActions = ['keepLocal', 'skip']; }
        }
        // Preview-only acknowledgement. commitMerge decides whether it is accepted.
        entry.baseline = remote;
      } else {
        var sourcePattern = patternKey(remote), legacyMatches = legacyByPattern.get(sourcePattern) || [];
        if (incomingSnapshotCounts.get(JSON.stringify(remote)) > 1 || (legacyMatches.length && (legacyMatches.length > 1 || incomingPatternCounts.get(sourcePattern) > 1))) {
          item.type = 'conflict'; item.reason = 'AMBIGUOUS_SOURCE_OR_LEGACY_IDENTITY'; item.allowedActions = ['skip']; preview.push(item); return;
        }
        var related = proposed.filter(function (row) { return row.sourceKey === occurrence.sourceKey && row.week === occurrence.week && row.sourceOccurrenceId !== id; });
        if (related.length) {
          item.type = 'conflict'; item.reason = 'RELATED_PATTERN_CHANGED'; item.relatedSourceIds = related.map(function (row) { return row.sourceOccurrenceId; }); item.allowedActions = ['skip']; preview.push(item); return;
        }
        var exact = localRows.filter(function (row) { return same(row.snapshot, remote); });
        if (exact.length === 1 && !reserved.has(associationKey(exact[0].association))) {
          item.type = 'bindExact'; item.association = exact[0].association;
          var bound = { sourceOccurrenceId: id, sourceKey: occurrence.sourceKey, week: occurrence.week,
            baseline: remote, association: item.association, tombstone: false };
          entries.set(id, bound); proposed.push(bound); reserved.add(associationKey(item.association));
        } else {
          var knownClass = proposed.some(function (row) { return row.sourceKey === occurrence.sourceKey; });
          var fuzzy = localRows.filter(function (row) {
            var sameName = row.snapshot.name === remote.name;
            if (sameName && knownClass) sameName = row.snapshot.date === remote.date || M.weekNumber(row.snapshot.date, state.settings.startMonday) === occurrence.week;
            return sameName || (row.snapshot.date === remote.date && row.snapshot.start === remote.start && row.snapshot.end === remote.end && row.snapshot.timeMode === remote.timeMode);
          });
          if (exact.length || fuzzy.length) {
            item.type = 'conflict'; item.reason = exact.length ? 'AMBIGUOUS_OR_ALREADY_BOUND_EXACT_MATCH' : 'POSSIBLE_EXISTING_LOCAL_COURSE';
            item.possibleAssociations = (exact.length ? exact : fuzzy).map(function (row) { return row.association; }); item.allowedActions = ['skip'];
          } else { item.type = 'addition'; item.allowedActions = ['add', 'skip']; }
        }
      }
      preview.push(item);
    });
    var seen = new Set(input.occurrences.map(function (row) { return row.sourceOccurrenceId; }));
    var unseen = ledger.entries.filter(function (entry) { return !seen.has(entry.sourceOccurrenceId); }).map(function (entry) { return entry.sourceOccurrenceId; });
    var canonical = { version: 1, source: ledger.source, entries: proposed };
    canonical = validateLedger(canonical);
    var token = 'merge-' + hash(JSON.stringify([state, ledger, input, legacyRows]));
    var invalidRows = input.invalid.reduce(function (n, item) { return n + (item.rowIndices ? item.rowIndices.length : 1); }, input.rejectedCount);
    var stats = { validOccurrences: input.occurrences.length, invalidOccurrences: invalidRows, duplicateRows: input.duplicateRows,
      additions: 0, exactBindings: 0, legacyBindings: legacyBindings.size, sourceUpdates: 0, conflicts: 0, protectedLocal: 0, deletedLocally: 0, unchanged: 0 };
    preview.forEach(function (item) {
      var key = { addition: 'additions', bindExact: 'exactBindings', sourceUpdate: 'sourceUpdates', conflict: 'conflicts', protectedLocal: 'protectedLocal', deletedLocally: 'deletedLocally', unchanged: 'unchanged', converged: 'unchanged' }[item.type];
      stats[key]++;
    });
    return { state: state, input: input, originalLedger: ledger, canonicalLedger: canonical, preview: preview,
      token: token, stats: stats, unseenSourceIds: unseen, canCommit: input.occurrences.length > 0 };
  }
  function planMerge(currentState, incoming, ledger, options) {
    var p = prepare(currentState, incoming, ledger, options);
    return { planToken: p.token, baseFingerprint: p.token, source: p.input.source, scope: p.input.scope, preview: p.preview, invalid: p.input.invalid,
      stats: p.stats, unseenSourceIds: p.unseenSourceIds, canCommit: p.canCommit,
      proposedLedger: { previewOnly: true, version: 1, source: p.canonicalLedger.source, entries: p.canonicalLedger.entries },
      limitations: ['No source absence can delete local courses.', 'Schedule/name source changes and ambiguous first matches require manual resolution.', 'A proposed ledger is not a committed ledger.'] };
  }
  function nextId(state, sourceValue, id) {
    var ids = new Set(state.courses.map(function (course) { return course.id; }));
    var base = (sourceValue.system==='just-jwglxt'?'just-occ-':'suike-occ-') + hash(JSON.stringify([sourceValue, id])), candidate = base, n = 1;
    while (ids.has(candidate)) candidate = base + '-' + n++;
    return candidate;
  }
  function addCourse(state, remote, id, color) {
    var c = { id: id, name: remote.name, day: remote.day, start: remote.start, end: remote.end, room: remote.room,
      teacher: remote.teacher, color: color || 'teal', dates: [remote.date], sourceTime: remote.sourceTime };
    if(remote.timeMode==='clock')c.timeMode='clock';
    if (remote.timeMode === 'pending') { c.timeMode = 'pending'; c.timeNote = remote.timeNote; }
    state.courses.push(c);
    return { courseId: id, date: remote.date };
  }
  function commitMerge(currentState, incoming, ledger, decision, options) {
    keys(decision, ['planToken', 'baseFingerprint', 'choices'], ['choices']);
    var p = prepare(currentState, incoming, ledger, options);
    var fingerprint = decision.baseFingerprint === undefined ? decision.planToken : decision.baseFingerprint;
    if (fingerprint !== p.token || (decision.planToken !== undefined && decision.planToken !== p.token)) fail('PLAN_STALE');
    if (!p.canCommit) fail('NO_VALID_OCCURRENCES');
    if (!Array.isArray(decision.choices) || decision.choices.length > MAX_ENTRIES) fail('CHOICES_INVALID');
    array(decision.choices, MAX_ENTRIES);
    var choices = new Map(), items = new Map();
    p.preview.forEach(function (item) { items.set(item.sourceOccurrenceId, item); });
    decision.choices.forEach(function (choice) {
      keys(choice, ['sourceOccurrenceId', 'action']);
      var id = str(choice.sourceOccurrenceId, 200, false), item = items.get(id);
      if (!item || choices.has(id) || item.allowedActions.indexOf(choice.action) < 0) fail('CHOICE_NOT_ALLOWED');
      choices.set(id, choice.action);
    });
    p.preview.forEach(function (item) { if (item.allowedActions.length && !choices.has(item.sourceOccurrenceId)) fail('CHOICE_REQUIRED'); });
    var resultLedger = p.canonicalLedger, entries = new Map(resultLedger.entries.map(function (entry) { return [entry.sourceOccurrenceId, entry]; }));
    var state = p.state, added = 0, updated = 0, addedGroups = new Map();
    p.preview.forEach(function (item) {
      var action = choices.get(item.sourceOccurrenceId), id = item.sourceOccurrenceId;
      if (action === 'skip' && entries.has(id) && item.baseline) entries.get(id).baseline = item.baseline;
      if (item.type === 'addition' && action === 'add') {
        var remoteGroup = {};
        SNAPSHOT_KEYS.forEach(function (key) { if (key !== 'date') remoteGroup[key] = item.incoming[key]; });
        var groupKey = JSON.stringify([item.sourceKey, remoteGroup]), group = addedGroups.get(groupKey), newAssociation;
        if (group) {
          group.dates.push(item.incoming.date); group.dates.sort();
          newAssociation = { courseId: group.id, date: item.incoming.date };
        } else {
          newAssociation = addCourse(state, item.incoming, nextId(state, p.input.source, id));
          addedGroups.set(groupKey, state.courses[state.courses.length - 1]);
        }
        var newEntry = { sourceOccurrenceId: id, sourceKey: item.sourceKey, week: item.week,
          baseline: item.incoming, association: newAssociation, tombstone: false };
        resultLedger.entries.push(newEntry); entries.set(id, newEntry); added++;
      } else if (item.type === 'sourceUpdate' && action === 'acceptSource') {
        var entry = entries.get(id), index = state.courses.findIndex(function (course) { return course.id === entry.association.courseId; });
        var course = state.courses[index], color = course.color;
        if (course.dates.length === 1) { course.room = item.incoming.room; course.teacher = item.incoming.teacher; }
        else {
          course.dates = course.dates.filter(function (d) { return d !== entry.association.date; });
          entry.association = addCourse(state, item.incoming, nextId(state, p.input.source, id), color);
          state.courses[state.courses.length - 1].sourceTime = course.sourceTime;
        }
        updated++;
      }
    });
    return { state: M.validateState(state), ledger: validateLedger(resultLedger), summary: { addedOccurrences: added, updatedOccurrences: updated,
      boundOccurrences: p.stats.exactBindings + p.stats.legacyBindings, protectedLocal: p.stats.protectedLocal, deletedLocally: p.stats.deletedLocally } };
  }
  return { validateLedger: validateLedger, parseLedger: parseLedger, planMerge: planMerge, commitMerge: commitMerge };
});
