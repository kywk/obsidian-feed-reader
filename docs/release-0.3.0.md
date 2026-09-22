# 0.3.0 發布紀錄

日期：2026-09-22。

- 多語系提交：9654834；發布提交：2bf755f。
- main 與 tag `0.3.0` 已推送；manifest、package 與 lockfile 版本一致，最低 Obsidian 版本宣告維持 1.8.7。
- [GitHub Release 0.3.0](https://github.com/kywk/obsidian-feed-reader/releases/tag/0.3.0) 已公開並設為 Latest，非 draft／prerelease。
- 三個安裝附件均為 uploaded；GitHub 回傳的 SHA-256 digest 與本機建置產物一致。

| 附件 | SHA-256 |
|---|---|
| main.js | 5b13b5bd562fa66935622cd1b72a009dba15ee7d7b15929ce216fbac6a85230f |
| manifest.json | a4e7aa3bea4ad2c9d765f4a6cd3fecbcfe3d4da307d50894f8d3e63cfd07cab4 |
| styles.css | ca5ade4bea3a6da1093dc1c5e5f084d4db4d9b0da12bcb296b48cd1b6124e871 |

建置與測試範圍見 [多語系驗證](i18n-validation.md)：191 passed、1 opt-in scale skipped。未執行本版 Obsidian 實機／最低版本驗證，未安裝到使用者 vault。發布當下尚未操作官方目錄送審；後續送審狀態見下方紀錄。GitHub 公開不代表官方審查通過。

## 官方送審

2026-09-22 依使用者要求，在 [官方管理頁](https://community.obsidian.md/account/plugins/vault-feed-reader) 執行 **Check for new releases**。

官方回覆：**Your manifest points at version 0.3.0. A scan has been queued.** 已確認 0.3.0 排入掃描，尚未取得本版審查完成結果。

送審前觀察到 0.2.0 審查狀態為 Completed，Current release 為 0.2.0；此資訊不代表 0.3.0 已通過。
