# 0.5.0 發布紀錄

日期：2026-09-24。

- 功能提交：
  - `481e313`: 預設未讀清單與篩選設定。
  - `21ecd00`: 單一 Feed 雜誌卡片版面（縮圖、作者、時間、摘要與日期分組）。
  - `d6c20ae`: 可變更 Feed Reader 根目錄（提供搬移原檔案或建立新來源對話框）。
- 版本準備提交：`87f84c2`。
- main 與 tag `0.5.0` 已推送。[GitHub Release](https://github.com/kywk/obsidian-feed-reader/releases/tag/0.5.0) 已公開並設為 Latest，非 draft／prerelease。
- manifest、package、lockfile 與 versions.json 版本一致；最低 Obsidian 版本宣告維持 1.8.7。
- `npm run build` PASS；`npm test` PASS：30 files、215 passed、1 opt-in scale skipped。`git diff --check` PASS。
- 三個附件下載雜湊與本機一致。
- 未由 agent 實測原生行動裝置相容性；未執行 opt-in scale 測試。

| 附件 | SHA-256 |
|---|---|
| main.js | 131f34c940bbdf4e0b4072b86548b87d5ef3836abc0d406f16e77b0008b18202 |
| manifest.json | abaa81b8ed8d8c5184d966107405187e8e22b79a7b15702d72644c789ec05287 |
| styles.css | 7b17231366d978b1da3a8c5ee61219274dbad4af433e34797defa7c7016c20fb |

## Obsidian 官方發布流程

本版尚未在 [官方管理頁](https://community.obsidian.md/account/plugins/vault-feed-reader) 執行 Check for new releases；該步驟需網站登入，agent 未代為執行。
