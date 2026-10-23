# 0.6.1 發布紀錄

日期：2026-10-23。

- 效能優化提交：
  - `3b44b94`: IndexedDB 單次 transaction `predicate` 過濾、以 `index.count()` 加速 500 篇保留上限淘汰、`ReadStateService` WeakMap 編譯 `Set` 與時間戳快取、忽略自身寫入觸發的重複重載與無關 Vault 筆記變更通知、重用 XML 解析與建構器實例。
  - `a5cfe41`: `SourcesView` 單一來源增量未讀數更新與 Favorite／Read Later 局部計數更新、`ReaderView` 列表渲染預建來源標題索引與消除重複重繪、快取 `Intl.DateTimeFormat` 與重用 `DOMPurify` 實例。
- 版本準備提交：`70d4be7`。
- main 與 tag `0.6.1` 已推送。[GitHub Release](https://github.com/kywk/obsidian-feed-reader/releases/tag/0.6.1) 已公開並設為 Latest，非 draft／prerelease。
- manifest、package、lockfile 與 versions.json 版本一致；最低 Obsidian 版本宣告維持 1.8.7。
- `npm run build` PASS；`npm test` PASS：32 files、228 passed、1 opt-in scale skipped；`npm run test:scale` PASS：2 passed。`git diff --check` PASS。
- 三個附件上傳雜湊與本機一致。
- 未由 agent 實測原生行動裝置或本版 Obsidian 桌面實機操作。

| 附件 | SHA-256 |
|---|---|
| main.js | b37afbbfbb7733f00bd0b3e6dbbe128b46582fe2832cc9eeb8e73239ef2a1813 |
| manifest.json | f7885fe6c4a0d40eb4bb8fdab9db050f3740c1a34157014b675a676c92b09ccb |
| styles.css | 0831803f74234c0513ea05ea8fab7df1e219be2111a2a3e217af6e8dd571308e |

## Obsidian 官方發布流程

本版尚未在 [官方管理頁](https://community.obsidian.md/account/plugins/vault-feed-reader) 執行 Check for new releases；該步驟需網站登入，agent 未代為執行。
