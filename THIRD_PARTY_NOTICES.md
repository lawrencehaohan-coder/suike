# 第三方代码与素材

本项目的 MIT 许可证不替代第三方组件的许可证。

- 场景：bas3line/ascii，MIT。原始 GIF/SVG、生成器与许可证位于 `android/work/android-app/vendor/ascii-rest/`；显示资源位于 `assets/ambient-scenes/`。纳入 scenes 分类除 green-storm 外的 33 件作品。上游：https://github.com/bas3line/ascii 。
- 液态玻璃：`vendor/liquid-glass-react/`、`vendor/liquid-glass-optics/`，分别保留原仓库许可证和说明。
- 设置图标：Lucide / Feather，ISC / MIT，见 `android/work/android-app/licenses/settings-icons.txt`。
- 数字字体：OFL，见 `android/work/android-app/assets/licenses/fonts/Suike-Numbers-OFL.txt`。
- 离线 OCR：Tesseract4Android、Tesseract、tessdata_fast、Leptonica、libpng、IJG。各自许可、固定版本和哈希见 `android/work/android-app/product/vendor/README.md`、`licenses/` 和 `licenses.lock.json`。
- 构建依赖 esbuild 和 TypeScript 按各自上游许可证使用。SDK 不包含在仓库内。

二次分发时请保留对应组件的许可证、版权声明和 OCR THIRD-PARTY-NOTICES。

- 校园示意图：原始校园几何来源于 OpenStreetMap contributors，适用 ODbL。原工程、来源记录、平面校正和高度估算记录位于 `android/work/android-app/vendor/just-zjg-campus/`，几何数据不纳入项目原创代码的 MIT 许可。建筑高度为近似估计。源码不包含实拍研究照片或航拍视频。
