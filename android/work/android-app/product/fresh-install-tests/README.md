# 独立真实首次安装验证

此测试与旧导入、原生功能 instrumentation 使用不同包名：`cn.suike.timetable.freshinstalltests`。测试 APK 读取现有签名配置构建，不复制或输出密码，不修改正式源码或旧测试目录。

构建及 CPU 安全限制检查，不调用 ADB：

```powershell
python work/android-app/product/fresh-install-tests/build.py
python work/android-app/product/fresh-install-tests/test_runner_guards.py
```

仅在其他模拟器测试已完成后，由 root 明确调用：

```powershell
python work/android-app/product/fresh-install-tests/run.py --fresh-install --apk "正式1.4.0 APK绝对路径" --expected-sha256 "正式APK的64位SHA256"
```

**这条命令会卸载指定自有模拟器上的随课及其原数据。** 缺少 `--fresh-install`、APK 哈希不同、版本不是 1.4.0/code9、正式包与测试包签名不同、ADB 5041 不是唯一的 `emulator-5582 / Suike_API36 / ranchu / API36`，均在卸载前拒绝。设备列表含真机或其他模拟器也拒绝。所有 ADB 指令固定使用 5041 与 5582；卸载目标固定为 `cn.suike.timetable`，不接受动态包名。

运行分两阶段，各自执行独立 instrumentation 进程：

1. 真正卸载后安装正式包，核对原生 `isFreshInstall()`、初始 0 门课程/0 次上课、`skipLegacyImportBaseline:true`、`setupCompleted:false`。
2. 等待正式页面自动弹出首次引导，填写第一周周一 `2026-08-31`、专业“机器人工程”、1 班、第一批，点击实际“保存设置”按钮，检查页面状态与持久 localStorage 一致且课程仍为 0。
3. 运行器 force-stop 后启动第二个 instrumentation 进程，核对进程 PID 已改变，课程仍为 0、设置完成标记及上述档案仍保留，并等过引导计时器以确认引导没有重新弹出。
4. 成功后重新打开正式主界面，保留已完成引导的空白课表，不恢复旧私有基线。任何检查失败均失败，没有跳过分支。

Instrumentation 不手动清理/改写 localStorage，不伪造首次安装标志，不操作学校门户、登录或真实截图。构建报告中的 `deviceTested:false` 仅说明构建状态。只有运行后 `reports/runtime-result-api36.json` 中 `passed`、`firstLaunchPassed`、`processRestartPassed`、`finalMainBlank` 全为 true 才证明实际运行成功。报告只包含固定检查项、状态计数及固定错误码，不打印课表备份或凭证。测试目录和内部测试 APK 不进入交付 APK/outputs。
