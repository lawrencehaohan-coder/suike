# 原生提醒与持久化内部运行验证

测试只允许工作区 ADB 5041 下的 `emulator-5582 / Suike_API36 / ranchu / API36`。运行器检查设备列表中没有真机；Instrumentation 本身还检查 API 与硬件。测试不启动学校门户，不读取真实登录、用户截图或浏览器数据。

构建内部同签名测试 APK（读取现有签名文件，不复制或输出密码）：

```powershell
python work/android-app/product/android-tests/build.py
```

root 启动自己的 API36 AVD 并准备正式 1.4.0/code9 APK 后运行：

```powershell
python work/android-app/product/android-tests/run.py --apk "正式APK绝对路径" --expected-sha256 "该构建的SHA256"
```

运行器先核对正式包哈希与版本，再覆盖安装正式包和独立测试包。它保存通知权限状态，测试前授予通知权限，测试结束并停止目标进程后恢复原状态。测试自身保存并恢复原生投影文件、完整 workspace 检查点和提醒去重偏好，并取消自己产生的通知。它不修改网页 localStorage，适合放在旧 UI instrumentation 之前或之后单独运行。测试失败也执行恢复；如果整个进程遭到 native 崩溃或外部杀死，必须检查报告中的恢复标志，不能按通过处理。

实际检查正式类 `FeatureScheduler`、`FeatureAlarmReceiver` 和 `NoticeOcr`，没有复制生产实现：

1. 十种无效载荷拒绝后，私有投影字节保持不变；未知字段不持久化。
2. 开启时发布的下一调度时间正确，关闭/清空后的调度状态清除，关闭不删除课表投影数据。
3. 验证桌面组件 Provider、pin API 与旧状态字段已经移除。
4. 短未来课程到期前调用正式 receiver 不提醒，到期后调用正式 receiver，通过真实 `NotificationManager` 检查通知发布；第二次调用不重发；关闭清理已发提醒。
5. 单课关闭与静音优先于单课开启，均不发布提醒。
6. 测试 ContentProvider 自行绘制黑白中文通知 PNG，经正式离线 `NoticeOcr` 识别，要求实际结果包含“高等数学”“通知”“教室”和“A301”。识别失败或超时直接失败，不跳过。
7. 原生 workspace checkpoint 同步读写回环、九种无效信封（含 UTF-8 超过16MiB）拒绝且不覆盖、损坏/无效编码读取抛安全异常而非 null、未完成 `.new` 写入不替换已提交版本；字符串内 JSON 保持不解析。
8. 实际启动正式 MainActivity，等待正式就绪后通过受信 WebView 的 `SuikeNative` 同步桥写入并立即读回，检查缺失时返回明确字符串 `"null"`、前置拒绝不覆盖，以及损坏读取不能返回 null/有效字符串。测试没有直接更改网页 workspace 内存或 localStorage；正式 bootstrap 仍会按产品规则处理镜像。
9. 在桥测试前，使用恢复后的原始 checkpoint 连续执行二十次正常 MainActivity finish、重建和就绪检查，保留生产 15 秒看门狗；逐次记录 ready 耗时与固定失败码，失败时也保留已完成的记录。早期异步采样只返回 boot 阶段、桥响应类型/null/undefined 标志、trust 标志与 adapter/recovery 固定错误码；recover 在内存副本运行，不调用原生保存。此项为同进程 Activity 重建，不代表强制停止后的新进程冷启动；使用运行前的原始数据，不生成大历史数据。

提醒测试主动调用正式 alarm receiver，**没有测量 Android 十分钟非精确窗口的实际后台唤醒时间**，也不能证明厂商省电策略下的可靠性。调度清理通过生产状态和关闭后的发布行为检查，没有把元数据检查描述成精确闹钟实测。测试不覆盖系统相册选择器的手动交互或真机表现。

`build/verification.json` 只证明编译、DEX 与签名检查完成，`deviceTested:false`。只有运行后 `reports/runtime-result-api36.json` 中 `passed`、`nativeSnapshotRestored`、`notificationPermissionRestored` 全部为 true 才通过。失败报告保留固定步骤、异常类型和固定错误码，不包含原生课表、OCR 正文或凭证。测试源码、测试 APK 和报告均为内部材料，不应放入交付 APK/outputs。

启动失败时可由 root 在自有 AVD 单独运行固定诊断：

```powershell
& work/android-tools/sdk/platform-tools/adb.exe -P 5041 -s emulator-5582 install -r -t work/android-app/product/android-tests/build/suike-native-feature-instrumentation.apk
& work/android-tools/sdk/platform-tools/adb.exe -P 5041 -s emulator-5582 shell am instrument -w -r -e mode checkpoint-diagnostic cn.suike.timetable.featuretests/.FeatureInstrumentation
```

该模式不等待 ready、不需要通知权限、不调用保存接口；它临时停用本次 MainActivity 的就绪看门狗以保留失败网页，读取直接 Java checkpoint 结果、文件尺寸、仅校验合成载荷、桥类型/null/undefined 标志、固定 boot/adapter 错误码。生产网页自己的正常 bootstrap 仍可能保存。`diagnosticCompleted:true` 只代表诊断完成，`runtimeSuitePassed` 始终为 false，不能作为功能通过证据。
