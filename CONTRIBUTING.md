# 参与开发

先运行 `npm ci` 和 `npm test`。共享前端修改后运行 Android 的 `prepare-assets.py`，再通过鸿蒙的 `Sync-Android-Frontend.py` 同步平台适配。

Settings 是节次时间的唯一入口；课程编辑、按次调课和 AI 导入不得反向更改节次时间。独立事务使用真实起止时刻，不能强行占用整节课。保留离线数据、导入确认、撤销和第三方许可。

请在 PR 中说明具体问题、改动和验证结果。不要提交个人课表、账号、登录 Cookie、API Key、签名文件、SDK、构建输出或未经授权的图片壁纸。

