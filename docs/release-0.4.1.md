# 0.4.1 發布紀錄

日期：2026-09-23。

- 審查修正提交：64e8f01；審查文件：61e5a28；測試逾時：7ea794b；版本發布提交：b00c916。
- main 與 tag `0.4.1` 已推送。[GitHub Release](https://github.com/kywk/obsidian-feed-reader/releases/tag/0.4.1) 已公開並設為 Latest，非 draft／prerelease。
- manifest、package、lockfile 與 versions.json 版本一致；最低 Obsidian 版本宣告維持 1.8.7。
- `npm run build` PASS；`npm test` PASS：28 files、195 passed、1 opt-in scale skipped。`git diff --check` PASS。
- 本機以 `eslint-plugin-obsidianmd` 0.4.2 推薦設定掃描 `src`：0 errors、1 warning（`settings-tab/prefer-setting-definitions`，需 Obsidian 1.13 宣告式 API）。此為外掛推薦設定重現，非官方掃描器逐項等價。
- 三個附件由 GitHub 下載後 SHA-256 與本機一致。
- 未由 agent 實測原生 Obsidian、popout window 及最低版本相容性；未執行 opt-in scale 測試。

| 附件 | SHA-256 |
|---|---|
| main.js | d6f05ed22d24061ca9e3ce38ce241c472968d2be62e4ddebb94072a15448cc49 |
| manifest.json | 96032ec87cbefe1720f9bf64cdded9e37422289fc549f21ffee21373aa7afc7a |
| styles.css | 653be8c5d63c9729f16474f4b56647d94632f8c1dd2bd78baba3f06a44b56373 |

## Obsidian 官方發布流程

本版尚未在 [官方管理頁](https://community.obsidian.md/account/plugins/vault-feed-reader) 執行 Check for new releases；該步驟需網站登入，agent 未代為執行。0.4.0 掃描結果為 46 warnings／Review: Caution，本次修正範圍與未修正項見[審查修正與驗證](community-review-validation.md)。送審前頁面顯示 0.4.0 排入掃描；不將先前版本結果當成本版通過。
