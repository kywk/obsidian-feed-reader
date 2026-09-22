# 0.4.0 發布與送審紀錄

日期：2026-09-22。

- 閱讀導覽提交：3003f2a；發布提交：e26506f。亦包含 eb716dd、c815ef0 的標題列精簡與複製連結操作。
- main 與 tag `0.4.0` 已推送。[GitHub Release](https://github.com/kywk/obsidian-feed-reader/releases/tag/0.4.0) 已公開並設為 Latest，非 draft／prerelease。
- manifest、package、lockfile 版本一致；最低 Obsidian 版本宣告維持 1.8.7。
- `npm run build` PASS；`npm test` PASS：28 files、195 passed、1 opt-in scale skipped。`git diff --check` PASS。
- 測試涵蓋 Markdown 連結 escaping、複製操作與失敗恢復、導覽標題、捲動顯示／返回頁首／返回列表／關閉清理。jsdom 不等同原生 Obsidian。
- 三個附件 SHA-256 與本機一致；obs-feedly 已安裝相同三檔並逐位元組比對，舊檔已暫存備份，data.json 保持不變。
- 未由 agent 實測原生剪貼簿、第三方主題及最低版本相容性；未執行 opt-in scale 測試。

| 附件 | SHA-256 |
|---|---|
| main.js | 99f6f1fe8411b1c15f2b216c1ebb7b9842c4bdd3510a787592e591c6ffc7f0c3 |
| manifest.json | c5841ffb7584043a91d3d835495c53b1a98f8bfdc474a4d7db2155c1150bb868 |
| styles.css | 653be8c5d63c9729f16474f4b56647d94632f8c1dd2bd78baba3f06a44b56373 |

## Obsidian 官方發布流程

在 [官方管理頁](https://community.obsidian.md/account/plugins/vault-feed-reader) 執行 Check for new releases，回覆：**Your manifest points at version 0.4.0. A scan has been queued.**

本版已送交官方掃描，尚未取得審查完成結果。送審前頁面顯示 0.3.0 為 Completed，Current release 為 0.3.0；不將先前版本結果當成本版通過。
