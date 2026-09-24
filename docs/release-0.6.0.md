# 0.6.0 發布紀錄

日期：2026-09-25。

- 功能提交：
  - `013ff00`: vault-backed 我的最愛（Favorite）與稍候閱讀（Read Later）服務。
  - `b7f7b36`: 保存筆記狀態偵測與變更訂閱機制。
  - `4ae58ff`: 側邊欄四項快速導覽、文章列表篩選與視圖分組、精簡閱讀工具列與儲存圖示狀態。
  - `7f70e93`: 重整雙語 README 為 5 大簡明章節。
- 版本準備提交：`6b7cb36`。
- main 與 tag `0.6.0` 已推送。[GitHub Release](https://github.com/kywk/obsidian-feed-reader/releases/tag/0.6.0) 已公開並設為 Latest，非 draft／prerelease。
- manifest、package、lockfile 與 versions.json 版本一致；最低 Obsidian 版本宣告維持 1.8.7。
- `npm run build` PASS；`npm test` PASS：32 files、226 passed、1 opt-in scale skipped。`git diff --check` PASS。
- 三個附件下載雜湊與本機一致。
- 未由 agent 實測原生行動裝置相容性；未執行 opt-in scale 測試。

| 附件 | SHA-256 |
|---|---|
| main.js | 04a4aeb2f0894861ac35603efa1c1957e58227c0b2d50fc543767f9340d04b5e |
| manifest.json | beeefad19f258c5277e0a9348eb4899e9d25079776fbb737c7f5153245d73d59 |
| styles.css | 0831803f74234c0513ea05ea8fab7df1e219be2111a2a3e217af6e8dd571308e |

## Obsidian 官方發布流程

本版尚未在 [官方管理頁](https://community.obsidian.md/account/plugins/vault-feed-reader) 執行 Check for new releases；該步驟需網站登入，agent 未代為執行。
