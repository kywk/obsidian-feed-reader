# 發佈檢查清單

本文件整理上架準備與尚待確認事項；不代表已通過 Obsidian 審查或已發佈。主 README 為英文，繁體中文版本為 [README.zh-TW.md](../README.zh-TW.md)，產品資訊變更時應同步維護。

## 專案內資訊

- [manifest.json](../manifest.json)：外掛 ID、名稱、作者、版本、最低 Obsidian 版本及桌面限制。
- [package.json](../package.json) 與 lockfile：開發命令、依賴及 MIT 授權宣告。
- [versions.json](../versions.json)：各發佈版本所需的最低 Obsidian 版本。
- [LICENSE](../LICENSE)：MIT，2026 kywk。
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)：依目前 lockfile 收錄非開發依賴的授權原文，包含間接依賴；不表示每個套件都進入最終 bundle。DOMPurify 選用 Apache-2.0 授權。更新依賴時需同步檢查聲明、版本及上游 NOTICE。
- [README.md](../README.md)：用途、安裝、操作、限制、資料位置、網路使用、問題回報及授權。

Git remote 已設定為 [kywk/obsidian-feed-reader](https://github.com/kywk/obsidian-feed-reader)，問題回報入口為 [GitHub Issues](https://github.com/kywk/obsidian-feed-reader/issues)。儲存庫公開可見性與 Issues 是否啟用仍需在發佈前確認。

## 本機準備

1. 使用 Node.js 22 執行 `npm ci`、`npm run build`、`npm test`。
2. 確認 manifest 與 package／lockfile 版本一致，且 versions.json 對應最低版本正確。Release tag 必須與 manifest 完全相同，例如 `0.1.0`，不加 `v`。
3. 確認建置產物為 `main.js`，以及根目錄的 `manifest.json`、`styles.css`。建置會將本專案與第三方授權全文嵌入 main.js。
4. 在隔離測試 vault 安裝上述三個檔案，驗證啟用／停用、訂閱更新、閱讀狀態、保存筆記與 OPML 匯入／匯出。記錄實際 Obsidian 版本；build 與 mock 測試不能取代實機驗證。
5. 最低版本目前宣告為 1.8.7；發佈前需確認使用的 API 與實測相容性，不因 TypeScript 通過就視為最低版本已驗證。

## GitHub 與官方提交

1. 建立 GitHub 儲存庫並推送來源；預設分支根目錄必須有 README、LICENSE、manifest。檢查要公開的內容不含私人資訊。
2. 從已驗證的同一份程式碼建立 GitHub Release，使用符合 manifest 的 tag，填寫功能、限制及驗證範圍。
3. 將 `main.js`、`manifest.json`、`styles.css` 作為獨立 Release 附件上傳，不能只提供原始碼 ZIP。授權檔保留於儲存庫；安裝用 main.js 已含聲明，不額外上傳非安裝附件（官方掃描建議）。
4. 登入 [Obsidian Community](https://community.obsidian.md/)，連結 GitHub，新增外掛並提交實際儲存庫。確認 `vault-feed-reader` ID 尚未被占用。
5. 依自動審查提示修正問題、遞增版本並建立新 Release。選擇 Publish 並解決審查錯誤後，才可由 Obsidian 安裝。
6. 後續版本同步維護版本資訊、雙語 README、授權聲明與驗證記錄，再建立新的 GitHub Release。

0.1.0 Release 與官方提交已完成；該版本未通過自動審查。0.1.1 修正首輪阻擋錯誤；0.1.2 再移除重複的外掛名稱設定標題，詳見[審查修正記錄](community-review-validation.md)。

## 尚待發佈前完成

- 已確認 GitHub 儲存庫公開可見且 Issues 已啟用。
- 已成功以 `vault-feed-reader` 建立官方目錄項目。
- 完成本次待發佈版本的 Obsidian 實機驗證及最低版本相容性確認。
- 完成 OPML 真實匯出檔互通驗證；既有範圍見 [OPML validation](opml-validation.md)。
- 0.1.0 Release、帳號連結與提交已完成；仍需新版通過官方審查。

## 官方依據

2026-09-22 查閱；發佈當下請再確認規則：

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
