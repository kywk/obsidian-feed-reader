# OPML 驗證記錄

日期：2026-09-22。分支：feat/opml。

## 結果

- `npm run build` 通過（TypeScript 與 esbuild），workspace `main.js` 已重新產生。
- `npm test` 通過：16 files、90 passed、1 opt-in scale skipped。
- 本次沒有變更文章快取或列表查詢，未重跑 100k 規模測試。

## 覆蓋

`tests/subscriptions/opml.test.ts` 驗證 OPML 1.0／1.1／2.0、title／text／URL 名稱 fallback、XML 字元、巢狀分類攤平、空分類、多分類重複 URL、匯出再匯入、無效文件與分類歧義。服務測試驗證重複 merge 不增加分類、merge 與 replace 沿用既有來源 ID、取消訂閱及服務重啟後再次匯入沿用 ID、持久化仍為 YAML，以及無效 replace 不寫入檔案。

`tests/ui/reader-view.test.ts` 新增管理頁流程，確認 OPML 格式傳入匯出／匯入服務、檔案選擇器接受 OPML，以及 replace 在確認前不執行。

既有 YAML／TOML、閱讀狀態、保存筆記、快取、排程與 UI 測試仍通過。

## 尚未驗證

- Obsidian 原生 UI 的檔案選擇、下載與實際匯入操作。
- Feedly、RSS Dashboard、Rho Reader 真實帳號／插件匯出檔的互通實測；目前使用標準結構的合成 OPML。
- 大型 OPML 匯入與大量來源更新效能。

本次未安裝到外部 vault，未變更既有使用者訂閱。
