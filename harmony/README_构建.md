# Windows 未签名 HAP 构建

本工程已用华为官方 **Command Line Tools for HarmonyOS 6.0.0.878 / Windows 64 位** 完成真实编译。验证环境为：HarmonyOS 6.0.0 API 20 Release SDK（6.0.0.47）、包内 Node.js 18.20.1、hvigorw 6.20.2、ohpm 5.3.2、JDK 17。

官方 CLI 压缩包 SHA-256：

```text
2f08bc0e2fffb73bd878202fd95ccc4e749eb95eb0c2231bf2e5c4d5d32563b9
```

工程 `hvigor/hvigor-config.json5` 的 `modelVersion: 6.0.0` 与上述 CLI 匹配，真实构建已通过；`dependencies: {}` 由配套 wrapper 使用其内置构建插件。不要把 `modelVersion` 改成 wrapper 的 6.20.2。

## 准备

从[华为官方下载中心](https://developer.huawei.com/consumer/cn/download/)自行登录并下载上述 Windows CLI，解压时保留目录结构。SDK 不包含在本源码包中。

下面使用的路径都是示例，请换成自己的实际安装目录。CLI 根目录应包含 `bin`、`ohpm`、`hvigor`、`tool/node` 和 `sdk`；SDK 包含 `sdk/default/openharmony` 与 `sdk/default/hms`。

## 推荐方式：在独立副本中构建

在源码根目录打开 PowerShell：

```powershell
.\tools\Build-Unsigned.ps1 -CommandLineToolsRoot 'D:\HarmonyOS\command-line-tools' -JavaHome 'D:\Java\jdk-17'
```

脚本会把源码复制到新的临时目录，再运行构建；原源码不会成为构建输出目录。脚本还会隔离并恢复本进程的工具缓存环境，拒绝签名配置。可用 `-BuildDirectory 'D:\Builds\suike-alpha1'` 指定一个尚不存在的输出目录。

首次使用新的工具缓存可能需要联网安装 pnpm 8.13.1。以后可指定 `-ToolCacheDirectory 'D:\HarmonyOS\suike-tool-cache'` 复用已经初始化的缓存；该目录内保存 `hvigor-cache`、`ohpm-cache`、`npm-cache` 和 `tool-user`。构建工程仍复制到新的 `BuildDirectory`，不会复用旧业务构建产物。未指定该参数时，缓存保存在本次构建目录的 `cache` 内。

若 Windows 的受限环境不允许构建工具创建 junction，可增加 `-NoToolLinks`。脚本只在本次构建副本里把构建依赖显式绑定到 CLI 内置的官方包，并复制其普通文件到独立依赖工作区；不改业务源码、不改 SDK，也不需要提升权限。绑定记录保存为构建目录中的 `tool-bindings.json`。这一模式仍需已初始化的 pnpm 缓存或首次联网。

```powershell
.\tools\Build-Unsigned.ps1 -CommandLineToolsRoot 'D:\HarmonyOS\command-line-tools' -JavaHome 'D:\Java\jdk-17' -BuildDirectory 'D:\Builds\suike-alpha1-rebuild' -ToolCacheDirectory 'D:\HarmonyOS\suike-tool-cache' -NoToolLinks
```

成功后脚本会输出 HAP 绝对路径与 SHA-256。结果文件在构建副本的 `entry/build/default/outputs/default/entry-default-unsigned.hap`。

## 手动方式：直接在源码根目录构建

```powershell
$cliRoot = 'D:\HarmonyOS\command-line-tools'
$env:JAVA_HOME = 'D:\Java\jdk-17'
$env:DEVECO_NODE_HOME = Join-Path $cliRoot 'tool\node'
$env:NODE_HOME = $env:DEVECO_NODE_HOME
$env:DEVECO_SDK_HOME = Join-Path $cliRoot 'sdk'
$env:Path = "$($env:NODE_HOME);$($env:JAVA_HOME)\bin;$env:Path"

& (Join-Path $cliRoot 'bin\ohpm.bat') install
& (Join-Path $cliRoot 'bin\hvigorw.bat') --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

首次构建保留 `ohpm install` 步骤，以生成/检查依赖元数据；当前工程没有额外三方 HAR 依赖，安装很快。Hvigor wrapper 首次初始化可能需要联网取得 pnpm 8.13.1 等构建工具；之后可复用对应缓存。

成功依据是官方日志 `BUILD SUCCESSFUL` 与实际 HAP 文件同时存在。`No signingConfig found for product default` 表示这一流程没有签名，并不影响生成未签名 HAP。

本产物用于编译验证；真机安装还需要开发者自己的调试签名。编译通过不等于完成真机运行测试。

## 可选的运行和字形检查

tools/Runtime-Smoke.py 只接受本机 API20 模拟器，需 Python 与 Pillow；会覆盖安装指定测试 HAP、切换页面并读取截图，不发送 AI 请求或改课程。测试前应先启动自己的模拟器并连接其专用 HDC 端口。

tools/Generate-Numerals.py 需 fontTools，可从随工程提供的数字字体重新生成卡片 SVG 字形。常规构建直接使用已打包的 SVG，无需重新生成。
