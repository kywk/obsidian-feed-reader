# 社群審查修正與驗證

日期：2026-09-22。來源：[官方掃描結果](https://community.obsidian.md/account/plugins/vault-feed-reader)。

## 0.1.0 掃描結果

官方對 f021602 的檢查：Failed。依賴檢查無已知漏洞；建置可逐位元重現 Release main.js，兩項皆通過。

阻擋錯誤與 0.1.1 修正：

| 項目 | 修正 |
|---|---|
| onunload 移除 leaves，導致使用者版面配置遺失 | 移除 detachLeavesOfType，由 Obsidian 管理已註冊 view；保留既有服務與排程清理 |
| 設定頁直接建立 HTML 標題 | 使用 Setting.setName().setHeading() |
| innerHTML 寫入 | DOMPurify 直接回傳 DocumentFragment 供 UI append；字串輸出與 fragment 共用清理設定及 URL hook |
| 直接指定固定樣式 | 訂閱匯入 textarea 寬度改用 CSS class |

新版本 Release 僅附 main.js、manifest.json、styles.css，依官方建議不再額外上傳非安裝附件。MIT 與第三方授權仍完整內嵌於 main.js，儲存庫亦保留原文。

## 本機驗證（0.1.1 完整工作區）

- PASS：`npm run build`（含 TypeScript）。
- PASS：`npm test`，16 test files、91 passed、1 opt-in scale skipped。
- PASS：新增清理回歸測試，確認 fragment 與保存 HTML 相同、移除執行碼／主題覆寫，拒絕 javascript、file、data URL 並正確解析相對 URL。
- PASS：`git diff --check`；src 無 innerHTML 寫入、detachLeavesOfType 或直接 style 屬性指定。
- NOT_RUN：原生 Obsidian 停用／重載分頁位置、設定頁外觀、最低版本 1.8.7、真實 OPML 互通及規模量測。既有 mock 與歷史實機結果不替代這些驗證。
- PENDING：0.1.1 官方重新掃描；本機測試不代表已通過上架審查。

## 未納入此次修正

0.1.0 的非阻擋項目：artifact attestations、vault 檔案枚舉、popout window／timer API、型別與 assertion 警告、控制字元正規表示式、較新版 declarative settings API、XML API 棄用、setWarning 棄用及未使用符號。未宣稱這些均已修復；版本相容性與後續整理需另行驗證。
