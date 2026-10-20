/* Anonymized sample rows and detail headings for parser regression tests.
 * Detail records were checked once per name/time signature, not per date.
 * Reusing them here tests known text parsing, NOT daily room verification.
 */
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '../timetable');
const read = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8').replace(/^\uFEFF/, ''));
function evidenceFixture() {
  const rows = read('portal-rows.json'), details = read('portal-details.json');
  const detailBySignature = new Map(details.map(detail => [JSON.stringify([detail.name, detail.sourceTime]), detail]));
  const initial = JSON.parse(fs.readFileSync(path.join(folder, 'dist/seed-data.js'), 'utf8').split('=', 2)[1].trim().replace(/;$/, ''));
  return {
    note: '每种课程时段抽查一条详情，未逐日核对地点变更；fixture 重用详情只用于解析回归测试。',
    rows, details, initial,
    capture: {
      source: 'just-schedule-dom',
      scope: { from: '2026-08-01', to: '2027-01-31', complete: true },
      rows: rows.map(row => ({ date: row.date, name: row.name, sourceTime: row.time,
        detailRaw: detailBySignature.get(JSON.stringify([row.name, row.time])).raw.slice() }))
    }
  };
}
module.exports = { evidenceFixture };
