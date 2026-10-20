# 随课 Android 原生功能合约（无桌面组件源码交接）

`MainActivity` 将 `SuikeNative` 仅安装到应用自己的离线 WebView。学校门户使用独立 Activity，没有这些接口。每次原生功能调用都检查 WebView 实例与已确认的 `https://suike.local` 文档；需要操作 UI 的方法在主线程再次检查当前 URL。回调脚本还会检查 `location.protocol` 和 `location.host`。这些接口不依赖课表启动完成标志，初始本地文档即可调用。提醒、OCR 等可选功能异常会返回固定错误或被隔离，不应阻断课表启动；权威 workspace 检查点损坏则必须安全停止读取/写入，避免旧浏览器镜像覆盖，属于需要明确呈现的存储错误。

## JavaScript → 原生

首次启动在内置 HTML 校验成功后、唯一固定 `https://suike.local/` 的 `loadUrl` 之前授权当前新建 WebView，避免 renderer 同步桥调用早于 UI `onPageStarted` 通知的时序问题。加载抛出 IOException/RuntimeException/LinkageError 时立即撤销，销毁与后续非本地 onPageStarted 同样撤销；外部导航拒绝、资源白名单、禁用网络、禁用 frame 与独立学校门户的边界保持有效。

| 方法 | 返回值 | 语义 |
| --- | --- | --- |
| `syncFeatures(payloadString)` | boolean | 接受完整原生课表投影并异步处理。`true` 表示接受排队，不表示已保存；结果通过 `nativeStatus` 回调。连续修改时只保留尚未处理的最新投影。 |
| `featuresStatus()` | JSON 字符串 | 同步读取固定字段状态。前端使用 `JSON.parse()`。不返回课程内容、地点、凭证或错误堆栈。 |
| `getWorkspaceCheckpoint()` | JSON 字符串 | 同步读取原生 workspace 权威检查点。只有文件确实不存在才返回字符串 `"null"`（JSON null 字面量）；存在时返回完整信封 JSON 字符串。损坏、无法读取或结构错误会抛固定安全 `IllegalStateException`，前端必须阻止旧浏览器数据覆盖，不能按“未保存”回退。 |
| `persistWorkspaceCheckpoint(payloadString)` | boolean | 同步校验并持久化完整 workspace 检查点；只有数据已写入、显式 FD.sync、AtomicFile 提交且确认读回一致后才返回 true。false/抛错表示没有获得持久化确认，磁盘结果可能不确定；前端应保留原内存显示并冻结后续写入，直到重启重新读取权威检查点。 |
| `isFreshInstall()` | boolean | `PackageInfo.firstInstallTime == lastUpdateTime`；用于区分新安装与覆盖更新，不能据此推断已有本地课表是否为空。 |
| `requestReminderPermission()` | boolean | 仅从用户启用提醒的点击调用。Android 13+ 使用请求码 **2201** 请求通知权限；较旧系统直接刷新状态。返回值只代表接受 UI 操作。 |
| `chooseNoticeScreenshot()` | boolean | 仅从用户选择截图的点击调用。使用系统图片选择器，请求码 **2104**；不申请相册/存储访问权限。返回值只代表接受 UI 操作。 |

`syncFeatures` 的载荷、字段限制、提醒覆盖规则、状态结果，见 [manifest-snippet.md](manifest-snippet.md)。无效或超过 1 MiB 的载荷不替换已有有效投影；课程删除或学期切换后必须发送新的完整投影，包括清空时的空 `occurrences` 数组。

workspace 检查点格式为 `{version:1,values:{...}}`；`values` 必须精确包含 `suike.timetable.v1`、`suike.history.v1`、`suike.semesters.v1`、`suike.workspace.transaction.v1` 四个键，每个值只能是字符串或 null。总载荷 UTF-8 上限 16 MiB。原生只验证外层信封，不解析字符串内的 JSON，语义校验与 journal 恢复由网页 workspace adapter 负责。额外/缺少/重复键、无效编码、错误版本和其他值类型会拒绝。文件位于应用私有目录 `workspace-checkpoint-v1.json`，正文与嵌套数据不记日志。

workspace adapter 在 Android 上应先读取此检查点作为权威来源。首次确无检查点时才允许迁移浏览器四个键；之后每次修改先将完整四键投影同步交给原生，成功后才提交内存，localStorage 只作为尽力写入的镜像。原生保存没有返回 true 时必须冻结后续写入，不能继续用旧 cache 写磁盘，也不能把 false 当作“磁盘必然还是旧值”；重启重读后再决定 journal 恢复或提示错误。四键与事务 journal 必须在同一检查点中，启动先恢复 journal 再使用状态。保存成功不能依赖 `Activity.onPause/onDestroy`、等待固定时间或 cookies flush。两个 checkpoint 桥方法都直接在 WebView bridge 后台线程执行同步 I/O，不将磁盘工作投递到 UI 线程。

`WorkspaceCheckpoint.read(Context)` 的 Java API 仍以 Java null 表示文件确实不存在；只有 JS 桥将它编码为字符串 `"null"`。已在 API36 系统 WebView 实测 Java String null 会传输为 JS undefined，因此前端必须只识别明确的字符串哨兵，不能将 undefined 或读取异常当作文件缺失。

## 原生 → JavaScript

```js
window.SuikeFeatures = {
  nativeStatus(statusObject) { /* 更新通知权限、提醒开关等显示 */ },
  receiveNoticeText(text, error) { /* 将识别文字放入可编辑预览，不直接改课表 */ },
  syncNative() { /* 根据当前网页状态重新调用 syncFeatures(JSON.stringify(payload)) */ }
};
```

原生使用 `JSONObject.quote` 将字符串作为数据参数传入，并对 U+2028/U+2029 做转义。状态 JSON 先重新序列化，再作为已引用的字符串经 `JSON.parse` 还原成对象。截图文字不被拼接为可执行脚本，也不会写入日志。

通知权限请求结束后，原生异步刷新调度和状态，再调用 `syncNative()`，让网页偏好与原生投影保持一致。Activity 恢复时也异步刷新调度与状态；页面尚未存在或回调尚未初始化时可以安全跳过，网页初始化仍应主动读取状态并同步投影。

OCR 返回的 `error` 只会是 `none`、`NO_TEXT`、`TEXT_TOO_LONG`、`OCR_FAILED`、`CANCELLED`、`INVALID_IMAGE`、`BUSY` 或 `PICKER_UNAVAILABLE`。用户取消选择不应被当成课表变更。OCR 由 `NoticeOcr` 在本机工作线程读取用户明确选中的 `content:` 图片，输入上限 24 MiB、宽高各不超过 16,000，解码采样到最长边不超过约 4,000 像素，识别文字上限 20,000 UTF-16 单元。识别模型随 APK 提供；不上传截图或识别文字。

## 注册与验证

Manifest 已注册 `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED` 与两个不导出的接收器；没有精确闹钟特殊权限。提醒使用十分钟窗口的非精确调度，系统省电可能进一步推迟或阻止提醒。通知权限被拒绝时，仍可在应用内查看本机课表。桌面组件能力已完整删除。

当前无桌面组件源码已通过全量 Java/DEX 编译与 aapt2 资源链接，OCR 锁定依赖、许可和 16 KiB 对齐检查通过。本次为前端完整工程交接，没有发布新版 APK 或重新进行 Android 运行验收。基线 1.4.0 的旧报告只代表当时发布的 APK，不能用于证明改版后运行通过。Kimi 完成界面后仍需回归测试和正式签名发布。
