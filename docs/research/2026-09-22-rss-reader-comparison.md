# Obsidian RSS 閱讀器比較

日期：2026-09-22

比較對象：本專案 Vault Feed Reader、RSS Dashboard、Rho Reader。

## 結論

延續本專案的「大量瀏覽、精選保存」方向，保留現有架構，優先借鏡 RSS Dashboard 的訂閱搬移與來源管理功能。若目標改為減少自行維護，或需要手機、全文擷取與影音閱讀，RSS Dashboard 是最值得實測的替代候選。Rho Reader 適合讓每篇閱讀項目直接成為 Obsidian 筆記入口的使用方式。

本次依據本機 README、核心資料模型、解析器與快取程式，以及上游 README、儲存指南與發布紀錄分析。未安裝實測另外兩款，沒有執行三者同條件效能或同步測試。上游預設分支文件可能包含不同於已發布版本的變更；查閱到的發布頁列出 RSS Dashboard 2.6.0 與 Rho Reader 1.1.0。

## 功能比較

| 面向 | Vault Feed Reader | RSS Dashboard | Rho Reader |
|---|---|---|---|
| 定位 | 大量瀏覽、精選保存 | RSS 與影音整合閱讀中心 | 用 Obsidian 檔案管理閱讀 |
| 閱讀方式 | 來源側欄、列表、正文；鍵盤切文 | Dashboard、內建 reader、影音播放器 | Bases 整合；預設開瀏覽器，可搭配 Web Viewer |
| Feed 格式 | RSS、Atom | RSS、Atom、JSON 等 | RSS、Atom、JSON Feed |
| 正文取得 | Feed 提供的正文／摘要 | 支援原文全文擷取；不保證每個網站成功 | 主要開原文連結 |
| 筆記產生 | 主動保存選中的文章 | 主動保存文章 | 每篇文章建立 Markdown |
| 筆記內容 | 正文／摘要、自訂模板與 Properties | 文章內容、模板與 frontmatter | Metadata、摘要與狀態；內文供記筆記 |
| 分類 | 單層資料夾；同來源可屬多個資料夾 | 多層資料夾、標籤、自動標籤 | Feed／文章標籤 |
| 訂閱搬移 | YAML／TOML；尚無 OPML | OPML 匯入／匯出 | OPML 匯入／匯出 |
| 影音 | 無專用播放器 | YouTube、Podcast、播放進度 | 未確認有同級播放器 |
| 平台 | 桌面限定 | 桌面與行動裝置 | 發布紀錄包含行動端修正 |

來源：[本專案 README](../../README.md)、[RSS Dashboard README](https://github.com/amatya-aditya/obsidian-rss-dashboard#readme)、[Rho Reader README](https://github.com/scriptnull/rho-reader#readme)、[Rho 發布紀錄](https://github.com/scriptnull/rho-reader/releases)。

## 儲存與同步的取捨

### Vault Feed Reader

- 訂閱以 vault YAML 為權威來源；閱讀狀態以每來源 JSON 儲存。
- 文章 metadata 與正文分別保存在本機 IndexedDB，列表每頁 50 筆、正文按需讀取，每來源保留最新 500 篇。
- 只有主動保存的文章會變成 Markdown 筆記，重複保存會開啟既有筆記，不覆寫人工編輯。
- 快取不隨 vault 搬移；重抓只能取回 feed 當下仍提供的內容，不能當歷史封存。
- 不處理跨裝置同步衝突。

適合讀很多、留少量，降低未保存文章進入筆記索引的數量。這是資料分工的優勢，不代表已證明效能勝過其他方案。

### RSS Dashboard

提供 Legacy JSON、Vault Shards v1 與 v2。Shards 使用每來源 JSON 儲存文章歷史；v2 將已讀、星號、標籤、保存與播放進度移至獨立 user-state.json。

內容可放在 vault 路徑，方便搬移與同步，但仍需要正確的 metadata 與儲存設定。官方 README 提醒新裝置須先完成同步再啟用，避免空白預設資料覆蓋既有訂閱。儲存指南明說沒有解決所有同步問題，不能將「支援同步」視為「沒有衝突」。

來源：[儲存指南](https://github.com/amatya-aditya/obsidian-rss-dashboard/blob/master/docs/storage-vault-shards-guide.md)、[同步說明](https://github.com/amatya-aditya/obsidian-rss-dashboard#syncing-across-devices)。

### Rho Reader

每個 feed 與每篇文章都有自己的檔案。文章 Markdown 的 frontmatter 儲存標題、連結、日期、閱讀狀態、標籤及摘要，內文留給使用者做筆記。

**每篇一個 Markdown 不等於保存全文。** 這種模式方便以 Obsidian 檔案與屬性處理閱讀清單，但大量訂閱也會產生大量檔案。索引與同步負擔可能增加是架構推論，未做同條件量測。檔案可隨 vault 同步，也不代表插件提供衝突合併。

來源：[Rho v0.4.0 檔案儲存說明](https://github.com/scriptnull/rho-reader/releases/tag/v0.4.0)。

## 成熟度與驗證界線

RSS Dashboard 的現成功能與发布歷程較完整，近期發布持續改善大量來源管理、更新控制、圖片快取與行動介面。Rho Reader 的設計較集中，已有公開發布與社群插件安裝說明。版本號本身不能證明穩定度。

本專案為未上架的 0.1.0 MVP。既有驗收記錄包含 72 個一般測試，以及先前的 100k metadata 規模檢查；後者使用 jsdom／fake-indexeddb，不能當作原生 Obsidian 的效能承諾，也不能用來對其他插件排名。原生大量資料、跨裝置與長期使用仍需驗證。

來源：[本專案驗收記錄](../history/2026-09-22-rss-reader-mvp/mvp-validation.md)、[Dashboard 發布紀錄](https://github.com/amatya-aditya/obsidian-rss-dashboard/releases)、[Rho 發布紀錄](https://github.com/scriptnull/rho-reader/releases)。

## 本專案建議方向

1. 優先新增 OPML 匯入／匯出，降低與 Feedly、Dashboard、Rho 及其他閱讀器之間搬移訂閱的成本。
2. 其次考慮來源自動探索與每來源更新設定，改善日常管理。
3. 全文擷取可作為按需功能另行評估，不改變現有精選保存模式。
4. 行動端、影音播放器與完整跨裝置閱讀歷史屬較大的產品範圍，需獨立決策。

## OPML 開發起點

以下是待實作時確認的設計要點，不表示功能已完成：

- 保留 YAML 為唯一訂閱權威來源；OPML 作為交換格式，沿用既有匯入合併與取代流程。
- 沿用 URL 去重、穩定來源 ID 與既有閱讀狀態，不把 OPML 匯入變成另一套訂閱儲存。
- 定義 OPML 多層 outline 對應本專案單層、多資料夾模型的規則，避免靜默丟失分類。
- 定義同來源屬於多個資料夾時的匯出與重新匯入行為。
- 處理標題欄位、XML escaping、空分類、缺少或不合法 xmlUrl 與錯誤文件。
- 驗證標準 OPML 樣本、分類、重複 URL、匯入／匯出 round trip，以及與既有 YAML／TOML 行為的相容性。
- OPML 主要搬移訂閱；不要承諾同步閱讀狀態、文章快取或保存筆記。
