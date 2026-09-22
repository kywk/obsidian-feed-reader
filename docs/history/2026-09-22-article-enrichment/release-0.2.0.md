# 0.2.0 發布紀錄

日期：2026-09-22。

- feature branch 四筆 commit 以 fast-forward 合併 main，保留原提交順序。
- 發布 commit：33e662634a70b968fa79c439afd451496719dac7。
- manifest/package/lockfile 版本 0.2.0，versions.json 最低 Obsidian 1.8.7。
- npm run build PASS；npm test：26 files、185 passed、1 opt-in scale skipped。
- [GitHub Release 0.2.0](https://github.com/kywk/obsidian-feed-reader/releases/tag/0.2.0) 已公開，非 draft／prerelease。main.js、manifest.json、styles.css 上傳完成，GitHub SHA-256 digest 與本機相同。
- [Obsidian 管理頁](https://community.obsidian.md/account/plugins/vault-feed-reader) 已檢查新 release，確認 0.2.0 / 33e6626 已排入掃描；本次記錄時狀態 Pending，目錄 Current release 仍為 0.1.2。
- 目錄長說明已更新本機 CLI 摘要與 tags，以及 CLI 可使用雲端模型的資料傳送行為。
- 已出現 Direct Filesystem Access、Shell Execution 警告與 artifact attestations 建議，掃描尚未完成，不能宣稱 0.2.0 已通過官方審查。

本機／mock 與程序測試不等於原生 Obsidian 或真實模型互通全面驗證。使用者可先由 GitHub Release 手動安裝；目錄新版可用性以官方最終審查狀態為準。
