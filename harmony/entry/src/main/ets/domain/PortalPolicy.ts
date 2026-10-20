export interface CapturePage { host: string; path: string; webVpn: boolean; }
export interface SchoolProfile {
  id: string; name: string; protocol: string; entryUrl: string; vpnUrl: string | null;
  allowedHosts: string[]; capturePages: CapturePage[]; collectorAsset: string;
  captureSource: string; adapterVersion: number; maxSections: number; help: string; collectorLayout: string;
}
interface SchoolRegistry { version: number; defaultSchool: string; schools: SchoolProfile[]; }
interface Term { year: string; semester: string; }
interface Period { period: number; start: string; end: string; }
interface PeriodGroup { group: number; first: number; last: number; start: string; end: string; }
interface PortalRow { cell: string; name: string; lines?: string[]; selected?: boolean; weekText?: string; teacher?: string; room?: string; }
export interface PortalCapture {
  source: string; adapterVersion: number; error?: string; term?: Term; rows?: PortalRow[];
  unscheduledPresent?: boolean; periods?: Period[]; periodCount?: number; periodGroups?: PeriodGroup[];
}
interface ParsedUrl { origin: string; host: string; path: string; }

export const MAX_CAPTURE_BYTES: number = 512 * 1024;
const JW_ERRORS: string[] = ['UNSUPPORTED_PAGE','TABLE_MISSING','TABLE_INVALID','TERM_MISSING','TERM_INVALID','TERM_MISMATCH','DAY_HEADERS_INVALID','PERIOD_HEADERS_INVALID','NO_COURSES','TOO_MANY_COURSES','COURSE_FIELDS_INVALID','SELECTION_UNKNOWN','CAPTURE_TOO_LARGE','COLLECTOR_FAILED'];
const JSXSD_ERRORS: string[] = ['UNSUPPORTED_PAGE','TABLE_MISSING','TABLE_INVALID','TERM_INVALID','WEEK_FILTER_ACTIVE','DAY_HEADERS_INVALID','PERIOD_HEADERS_INVALID','COURSE_FIELDS_INVALID','TOO_MANY_COURSES','NO_COURSES','CAPTURE_TOO_LARGE','COLLECTOR_FAILED'];

function invalid(): never { throw new Error('CAPTURE_INVALID'); }
function exactKeys(value: Object, names: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value).sort();
  if (actual.join('|') !== names.slice().sort().join('|')) invalid();
}
function text(value: string | undefined, max: number, required: boolean): string {
  if (typeof value !== 'string' || value.length > max || required && !value.trim() || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value;
}
function clock(value: string): boolean { return /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value); }
export function utf8Bytes(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) count++;
    else if (code < 0x800) count += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { count += 4; i++; }
    else count += 3;
  }
  return count;
}
export function schoolFromRegistry(raw: string, id: string): SchoolProfile {
  const registry = JSON.parse(raw) as SchoolRegistry;
  if (!registry || registry.version !== 1 || !Array.isArray(registry.schools) || !['just','hhu','njust'].includes(id)) throw new Error('SCHOOL_UNSUPPORTED');
  const profile = registry.schools.find((school: SchoolProfile) => school.id === id);
  if (!profile || profile.adapterVersion !== 1 || !Array.isArray(profile.allowedHosts) || !Array.isArray(profile.capturePages)) throw new Error('SCHOOL_UNSUPPORTED');
  const expectedAsset = id === 'just' ? 'teaching-collector.js' : id + '-teaching-collector.js';
  const expectedSource = id === 'just' ? 'just-jwglxt-table' : id + '-jsxsd-table';
  if (profile.collectorAsset !== expectedAsset || profile.captureSource !== expectedSource || profile.protocol !== (id === 'just' ? 'jwglxt' : 'jsxsd') || !allowedPortalUrl(profile, profile.entryUrl)) throw new Error('SCHOOL_UNSUPPORTED');
  return profile;
}
function parseAllowedUrl(school: SchoolProfile, value: string): ParsedUrl | null {
  if (!school || typeof value !== 'string' || value.length > 8192 || /[\\\x00-\x20\x7f]/.test(value)) return null;
  // Parse the authority strictly rather than accepting browser URL normalization, userinfo, or host suffixes.
  const match = /^https:\/\/([A-Za-z0-9.-]+)(?::443)?([/?#].*)?$/i.exec(value);
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (!school.allowedHosts.includes(host)) return null;
  const rest = match[2] || '/';
  const path = rest.startsWith('/') ? rest.split(/[?#]/)[0] : '/';
  return { origin: 'https://' + host, host: host, path: path };
}
export function portalOrigin(school: SchoolProfile, value: string): string | null {
  const parsed = parseAllowedUrl(school, value);
  return parsed ? parsed.origin : null;
}
export function allowedPortalUrl(school: SchoolProfile, value: string): boolean { return parseAllowedUrl(school, value) !== null; }
export function capturePageUrl(school: SchoolProfile, value: string): boolean {
  const parsed = parseAllowedUrl(school, value);
  if (!parsed) return false;
  return school.capturePages.some((page: CapturePage) => {
    if (page.host !== parsed.host) return false;
    if (!page.webVpn) return page.path === parsed.path;
    if (!parsed.path.startsWith('/http/') || !parsed.path.endsWith(page.path)) return false;
    const prefix = parsed.path.slice(6, parsed.path.length - page.path.length);
    return /^[A-Za-z0-9_-]{1,256}$/.test(prefix);
  });
}
export function parseCapture(raw: string, school: SchoolProfile): PortalCapture {
  if (typeof raw !== 'string' || raw.length > MAX_CAPTURE_BYTES || utf8Bytes(raw) > MAX_CAPTURE_BYTES) invalid();
  const capture = JSON.parse(raw) as PortalCapture;
  if (!capture || typeof capture !== 'object' || Array.isArray(capture) || capture.source !== school.captureSource || !Number.isInteger(capture.adapterVersion) || capture.adapterVersion !== school.adapterVersion) invalid();
  if (Object.keys(capture).includes('error')) {
    exactKeys(capture, ['source','adapterVersion','error']);
    const errors = school.protocol === 'jwglxt' ? JW_ERRORS : JSXSD_ERRORS;
    if (!errors.includes(text(capture.error, 40, true))) invalid();
    return capture;
  }
  if (school.protocol === 'jwglxt') {
    const captureKeys: string[] = ['source','adapterVersion','term','rows','unscheduledPresent'];
    if (Object.keys(capture).includes('periods')) captureKeys.push('periods');
    if (Object.keys(capture).includes('periodCount')) { captureKeys.push('periodCount'); if (!Number.isInteger(capture.periodCount) || (capture.periodCount as number) < 1 || (capture.periodCount as number) > 24) invalid(); }
    exactKeys(capture, captureKeys);
  } else exactKeys(capture, ['source','adapterVersion','term','rows','periodGroups','unscheduledPresent']);
  if (!capture.term) invalid();
  exactKeys(capture.term, ['year','semester']);
  const year = text(capture.term.year, 9, true), semester = text(capture.term.semester, 1, true);
  if (!/^[0-9]{4}-[0-9]{4}$/.test(year) || !(school.protocol === 'jwglxt' ? /^[12]$/ : /^[123]$/).test(semester) || typeof capture.unscheduledPresent !== 'boolean') invalid();
  if (school.protocol === 'jsxsd') {
    const first = Number(year.slice(0,4)), last = Number(year.slice(5));
    if (first < 1900 || last > 2200 || last !== first + 1) invalid();
    validateGroups(capture.periodGroups, school);
  } else if (Object.keys(capture).includes('periods')) { validatePeriods(capture.periods); if (capture.periodCount !== undefined && (capture.periods as Period[]).some((p: Period) => p.period > (capture.periodCount as number))) invalid(); }
  if (!Array.isArray(capture.rows) || capture.rows.length < 1 || capture.rows.length > 500) invalid();
  capture.rows.forEach((row: PortalRow) => {
    text(row.name, 80, true);
    if (school.protocol === 'jwglxt') {
      exactKeys(row, ['cell','name','lines','selected']);
      if (!/^[1-7]-(?:1[01]|[1-9])$/.test(text(row.cell,40,true)) || typeof row.selected !== 'boolean' || !Array.isArray(row.lines) || row.lines.length !== 4) invalid();
      row.lines.forEach((line: string) => { text(line, 200, false); });
    } else {
      exactKeys(row, ['cell','name','weekText','teacher','room']);
      if (!/^[1-7]-(?:[1-9]|1[0-2])$/.test(text(row.cell,10,true))) invalid();
      text(row.weekText,200,true); text(row.teacher,120,false); text(row.room,120,false);
    }
  });
  return capture;
}
function validatePeriods(periods: Period[] | undefined): void {
  if (!Array.isArray(periods) || periods.length < 1 || periods.length > 24) invalid();
  let previous = 0, previousEnd = '';
  periods.forEach((period: Period) => {
    exactKeys(period, ['period','start','end']);
    if (!Number.isInteger(period.period) || period.period < 1 || period.period > 24 || period.period <= previous || !clock(text(period.start,5,true)) || !clock(text(period.end,5,true)) || period.start >= period.end || previousEnd > period.start) invalid();
    previous = period.period; previousEnd = period.end;
  });
}
function validateGroups(groups: PeriodGroup[] | undefined, school: SchoolProfile): void {
  if (!Array.isArray(groups) || groups.length > 12 || groups.length < 2 && !(groups.length === 0 && school.collectorLayout === 'jsxsd-grid')) invalid();
  let previous = 0, previousEnd = '';
  groups.forEach((group: PeriodGroup, index: number) => {
    exactKeys(group, ['group','first','last','start','end']);
    if (!Number.isInteger(group.group) || !Number.isInteger(group.first) || !Number.isInteger(group.last) || group.group !== index + 1 || group.first !== previous + 1 || group.last < group.first || group.last > school.maxSections || !clock(text(group.start,5,true)) || !clock(text(group.end,5,true)) || group.start >= group.end || previousEnd > group.start) invalid();
    previous = group.last; previousEnd = group.end;
  });
  if (groups.length > 0 && previous < 8) invalid();
}
export function decodeCollectorEvaluation(callback: string, school: SchoolProfile): PortalCapture {
  if (typeof callback !== 'string' || callback.length > 1024 * 1024) invalid();
  const decoded = JSON.parse(callback) as string;
  if (typeof decoded !== 'string') invalid();
  return parseCapture(decoded, school);
}
