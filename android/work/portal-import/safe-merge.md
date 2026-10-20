# SafeMerge 接入契约

`safe-merge.js` 是纯数据模块，不联网、不读取 DOM、不写文件/存储、不执行页面代码。Node 导出与浏览器 `window.JustSafeMerge` 的 API 相同，浏览器需先载入 `TimetableModel`。

## 身份的实际含义

真实教务 DOM 只证明教学班 code 存在；`sourceOccurrenceId` 是适配器用学期、code、星期、节次、周次派生的 **pattern key**，不是上游稳定单次课 ID。账本同时保存 `sourceKey`（实际 code）和 `week`。同教学班、同周次出现不同 pattern key 时，只作 `RELATED_PATTERN_CHANGED` 冲突预览，不自动追加或删除旧课。改变周次/课程名等无法唯一识别的调整仍须人工核对。

## 输入

```js
const incoming = {
  source: { system: 'just-jwglxt', term: '2026-2027-1' },
  scope: { from: '2026-08-31', to: '2027-01-17', complete: true },
  occurrences: [{
    sourceOccurrenceId: 'adapter-derived-pattern-key',
    sourceKey: '(2026-2027-1)-actual-course-code',
    week: 1, date: '2026-08-31', name: '课程名称', day: 1,
    start: 1, end: 2, room: '网页提供的教室', teacher: '教师',
    sourceTime: '', timeMode: 'periods', timeNote: ''
  }],
  rejectedCount: 0
};
```

这里的日期和 code 仅为契约示例，不能用于补造页面缺失的数据。接入 teaching parser 时，只摘取上述四个顶层字段；其余 warnings/stats/term 等由 UI 单独展示，严格输入校验拒绝未知字段。每条课程须提供合法日期、星期、节次、显式空或有效教室/教师/来源时间；缺少 ID/code/周次、同 ID 不同内容等行进入无效结果，不以第一条 DOM 顺序决定课程。无明确晚间时间的课程可用 `timeMode:'pending', start:null, end:null, timeNote:'原网页节次及待确认说明'`。

当前状态使用现有 `TimetableModel` schema。账本单独传入 `state.importLedger`，无账本为 `undefined`/`null`。

## 账本

```js
{
  version: 1,
  source: { system: 'just-jwglxt', term: '2026-2027-1' },
  entries: [{
    sourceOccurrenceId: 'pattern-key', sourceKey: 'actual-code', week: 1,
    baseline: { date, name, day, start, end, room, teacher,
                sourceTime, timeMode, timeNote },
    association: { courseId: 'local-course-id', date: '2026-08-31' },
    tombstone: false
  }]
}
```

`validateLedger(value)` 返回新的规范账本；`undefined`/`null` 返回 `null`。严格拒绝未知字段、重复来源 ID、重复本地课次关联、非法日期/时间、缺失基线字段、带关联的 tombstone、稀疏数组等。`parseLedger(json)` 在 JSON 解析后执行相同校验。当前只支持一个来源学期，换学期必须有单独明确流程，不能静默重置不匹配的来源账本。最多 10000 条记录，课程总数仍遵守模型的 500 条上限。

账本必须与课程状态一同备份、恢复和撤销。现有通用 `validateState` 会丢弃未知字段，Android 接入时需明确保留 `importLedger = JustSafeMerge.validateLedger(input.importLedger)`；不要在另一存储键单独维护，避免课程和账本不一致。

## 预览与提交

```js
const options = { trustedLegacyBaseline: originalBundledSeed }; // 可选
const plan = JustSafeMerge.planMerge(state, incoming, state.importLedger, options);
// 用户确认后，对此刻的最新 state 重算并校验 fingerprint：
const result = JustSafeMerge.commitMerge(state, incoming, state.importLedger, {
  baseFingerprint: plan.baseFingerprint,
  choices: [{ sourceOccurrenceId: 'pattern-key', action: 'add' }]
}, options);
result.state.importLedger = result.ledger;
commit(result.state, '已确认导入');
```

`planToken` 是 `baseFingerprint` 的同义字段；仅用于发现预览后状态/来源/账本/可信旧基线发生变化，不是身份认证凭证。提交没有任何隐式存储写入；真正持久化由调用方现有 `commit` 完成。返回 `proposedLedger` 带有 `previewOnly:true`，`validateLedger` 会拒绝直接保存它。

每个 `preview` 项包含 `sourceOccurrenceId/sourceKey/week/incoming/type/allowedActions`，有需要时附 `reason/local/baseline/association/sourceChanges/localChanges/possibleAssociations/relatedSourceIds`。

| type | 行为及选择 |
| --- | --- |
| `addition` | 仅预览新增；允许 `add` 或 `skip`。UI 可默认勾选，但提交仍须明确传 `add`。 |
| `bindExact` | 首次唯一精确匹配，绑定已有课次，不修改课程。 |
| `unchanged` / `converged` | 保持课程；本地和来源一致时可更新基线。 |
| `protectedLocal` | 本地改名、节次、教室等保留，且不会再导入旧课。 |
| `deletedLocally` | 原关联课次消失后生成 tombstone，不复活课程。 |
| `sourceUpdate` | 仅来源教室/教师变化且本地未改：允许 `acceptSource`、`keepLocal`、`skip`，默认跳过。 |
| `conflict` | 按 `allowedActions` 仅 `skip`，或 `keepLocal/skip`；不允许覆盖本地。 |

所有 `allowedActions` 非空的项必须提供且仅提供一个 choice；自动保护/原样保持的项不传 choice。`skip` 保留原比较基线，下次仍显示未处理变化；`keepLocal` 明确承认新的来源基线并保留本地内容。`acceptSource` 只更新该次课，必要时把多日期课程拆出一次，其他日期、颜色、关联和实验保持。明确新增的相同教学班/相同课程信息会分组，账本仍逐次关联。

## 旧版本首次升级

只有调用方提供的应用内可信旧来源快照可作为 `trustedLegacyBaseline`；不能拿当前 state 或新网页数据代替。模块按旧快照 `name/day/start/end/date`（含待定模式说明）唯一匹配新来源，再用旧 `id/date` 查当前课程，从而保护升级前的改名、调课、删课。多个来源教学班或多个旧课次均能匹配时，不猜测绑定。原 seed 中未匹配的 13 次补充实验不参与任何覆盖或删除。

## 安全边界和限制

- 读取为空或全部无效时 `canCommit:false`，提交拒绝；任何完整/部分范围的未出现课次都不会删除本地课程。部分读取可追加已验证课次，但 UI 必须展示不完整和拒绝数量。
- 来源时间/名称/节次变化、本地与来源同时改变、模糊旧课匹配、同周 pattern 改变只展示冲突，首版不提供自动调整排课功能。用户需要在原有编辑功能中核对处理。
- 用户把课次换到另一个日期时，旧关联记为删除，新的本地安排保留；本模块不会猜测新的日期关联。
- 无可信旧基线且本地课程已经改名/调课时，不能仅凭内容恢复身份；模糊匹配不追加。对未知来源的新课，新增必须经过预览确认。
- tombstone 没有自动恢复功能。已删除课程需用户自己重新创建；来源缺失也不会当作删除通知。
- UI 使用 `textContent` 呈现所有来源文字；不得将本模块的纯数据保护误当成外部 WebView 的权限隔离。外部页面仍不可接触本地 `SuikeNative` 桥。

验证：`node --test work/portal-import/safe-merge.test.cjs`；覆盖真实现有 seed/13次实验保留、幂等、编辑/删除/日期移动保护、逐次教室变更、三方冲突、pattern 变化、可信旧基线、空读/部分读、陈旧预览、严格 JSON、夜课待定及文字注入边界。
