# 构建

前端源码入口是 `android/outputs/随课_离线课表.html`，扩展模块在 `android/work/android-app/`。打包的前端是 `android/work/android-app/assets/index.html`，鸿蒙共享前端在 `harmony/entry/src/main/resources/rawfile/index.html`。

## 前端

```sh
npm ci
npm test
```

需要重新生成 Android 前端时：

```powershell
$env:SUIKE_ESBUILD_MODULE = Join-Path (Get-Location) 'node_modules/esbuild'
python android/work/android-app/build-campus-geometry.py
python android/work/android-app/build-campus-preview.py
python android/work/android-app/prepare-assets.py
python harmony/tools/Sync-Android-Frontend.py android
```

常规构建直接使用仓库里的场景、OCR 与字体资源；修改场景转换脚本时另需安装 Pillow。

## Android（已验证 Windows 构建）

安装 JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。设置 `JAVA_HOME`、`ANDROID_SDK_ROOT` 后：

```powershell
python android/work/android-app/build.py --unsigned-only
```

兼容旧目录布局时可设置 `SUIKE_ANDROID_TOOLS`，目录需包含 `android-15/`（Build Tools）、`android-35/android.jar` 和带 `bin/javac.exe` 的 JDK 文件夹。

签名文件不在仓库内。自己的发布构建需通过 `SUIKE_SIGNING_KEY` 和 `SUIKE_SIGNING_PASSWORD_FILE` 指定 P12 文件和密码文件，别名为 `suike`；不要提交密钥或密码。更换签名的应用不能覆盖安装原作者已签名的版本。

## HarmonyOS

按照 [官方 SDK 构建说明](../harmony/README_构建.md) 配置 DevEco 工具。未签名 HAP 用于编译检查，安装前需自己的签名和设备授权。源码的服务模拟测试不等于真机验证。

