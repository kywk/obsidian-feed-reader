# Vault Feed Reader MVP validation

驗收日期：2026-09-22

## 結論

自動化建置與測試通過；100,000 筆 metadata 的可重現檢查確認 reader 首頁只建立 50 個文章 DOM row，初次載入不讀全文，開啟一篇後只讀一篇。Obsidian 1.13.7 實機 smoke 完成下列已執行流程；未執行項目不視為通過。

目前未發現 P0／P1 blocking defect。

## 自動化驗證

環境：Node.js 22.23.2、npm 10.9.8、macOS 27.0 arm64。

| 指令 | 結果 |
|---|---|
| `npm run build` | 通過；TypeScript typecheck 與 esbuild 均成功 |
| `npm test` | 通過；13 個 test files，60 個 tests 通過，1 個 opt-in scale test 略過 |
| `npm run test:scale` | 通過；2 個 scale tests 均通過，總時間 128.78 秒 |

新增的 acceptance 旅程把 RSS 與 Atom 一起走過訂閱、更新、metadata／全文快取、已讀、手動未讀、read-state 重啟、保存、重複保存不覆寫、移動後重開筆記，以及離線更新保留既有文章。它補足跨服務行為，沒有重複各服務的所有單元測試。

S7 其他條件由下列既有自動化覆蓋：

- YAML／TOML round trip、依 URL 合併、明確取代、外部有效／破損修改、寫入失敗與路徑切換：`tests/subscriptions/service.test.ts`
- RSS／Atom、缺欄位、相對 URL、穩定身分與惡意／破損 XML：`tests/feeds/parser.test.ts`
- 每來源 500 篇淘汰、分頁、vault 隔離、metadata 與正文分 store：`tests/cache/indexeddb-cache.test.ts`
- cutoff 嚴格邊界、同時刻、個別已讀、未讀例外、重啟與寫入失敗：`tests/read-state/service.test.ts`、`tests/integration/batch-read.test.ts`
- 多資料夾 scope、50 筆分頁、搜尋、未讀列穩定、快捷鍵輸入焦點與過期 cache 的 saved view：`tests/ui/reader-view.test.ts`
- 共用 sanitizer、惡意 URL／HTML、重複保存、同名文章、移動／刪除筆記與寫入失敗：`tests/integration/content-save.test.ts`、`tests/save/service.test.ts`
- reader 存在期間排程、逾期只補一輪、最後 reader 關閉與 unload 後停止更新：`tests/integration/scheduler.test.ts`
- 單一來源離線／解析失敗隔離、timeout、實體 concurrency、移除來源與 unload 後捨棄延遲結果：`tests/feeds/refresh-service.test.ts`

## 100,000 metadata 規模檢查

正式可重現入口是 `npm run test:scale`，實作位於 `tests/acceptance/scale.test.ts`。它刻意是 opt-in，避免日常 `npm test` 每次增加約兩分鐘。

| 層次 | 資料 | 首批 50 筆 | DOM rows | 初載全文讀取 | 開一篇後全文讀取 |
|---|---:|---:|---:|---:|---:|
| Reader + jsdom + metadata-only mock | 200 × 500 = 100,000 | 24.81 ms | 50 | 0 | 1 |
| `IndexedDbArticleCache` + fake-indexeddb | 200 × 500 = 100,000 | 12.98 ms | 不適用 | 0 個 content-store transaction | 不適用 |

fake-indexeddb 種入 100,000 筆共 127,919.74 ms，查詢結果有下一頁 cursor。量測證明目前程式的分頁與 store 存取界線；這是 Node.js 上的 jsdom／fake-indexeddb 檢查，不能解讀為 Obsidian 或瀏覽器 IndexedDB 的效能承諾。毫秒數會依機器與單次執行波動。

## Obsidian 實機 smoke

環境：Obsidian 1.13.7；測試 vault `/Users/kywk/Downloads/obs-feedly/obs-feedly`。

已觀察：

1. 插件可載入，Manage sources 可新增 `http://127.0.0.1:18765/rss`，一篇 RSS 文章會出現在列表。
2. 在 Unread 開啟文章可閱讀正文；fixture 中的 `script`／`iframe` 沒有可見元素，危險連結顯示為純文字。
3. 按 `m` 後 vault JSON 的 `readIds` 為空、`unreadIds` 含該 article ID；剛讀文章仍保留在當前 Unread 列表。
4. RSS 按 `s` 會建立 Markdown 並開啟新分頁；人工加入 `Manual smoke edit` 後再按 Save / open note，UI 顯示 `Opened saved article`，人工文字仍保留。
5. 新增 Atom 至 Technology 與 Reading 兩個資料夾後，全域列表只有一份該文章；文章可閱讀，`m` 與 `s` 均成功。從 Technology 閱讀後，Reading 的 Unread 顯示 `No articles`，兩個資料夾共享同一 read state。
6. Generate TOML export 顯示 2 sources／2 folders；直接 Merge import 後沒有產生重複來源。
7. 外部把 `feeds.yaml` 改成破損內容時，UI 顯示第 3 行語法錯誤、保留 last-good 的 2 sources，所有修改按鈕停用；還原備份後錯誤消失並自動重新載入。
8. 停止本機 fixture server 後按 Refresh，各來源顯示 `net::ERR_CONNECTION_REFUSED`，先前快取的 Atom 正文仍可閱讀；server 重啟後重新開 reader，來源錯誤已清除。
9. Settings 將 Mark read on j/k navigation 設為開啟，停用插件、換入最新 build 再啟用後，toggle 仍為開啟；確認後已還原為關閉。這驗證插件 disable／enable 的設定保留，沒有執行完整 Obsidian quit／relaunch。
10. 重新 Open reader 會看到 2 篇文章；重複按 ribbon 仍維持單一 reader。
11. Saved 顯示 2 篇筆記。RSS 筆記仍含 `Manual smoke edit`；在 Obsidian UI 將其改名為 `Renamed RSS smoke article` 後，從 Saved 點 RSS 會開啟新路徑，人工文字仍保留。
12. 曾關閉最後一個 reader 分頁再重開，reader 正常。文章全文、read state、設定與訂閱的落地資料均已實際讀取確認。

下列項目只有自動化覆蓋，未做對應實機驗證：完整 Obsidian quit／relaunch、等待 30 分鐘 scheduler、OS sleep／wake、關閉最後 reader 或 unload 後直接計數 timer／request、原生 IndexedDB 100,000 筆、200 個真實網路來源、快捷鍵輸入焦點、TOML replace、cutoff、500 篇淘汰／重新訂閱，以及檔案系統寫入失敗。這些未驗證項不視為實機通過。

## 已知限制與判讀

- 自動化測試使用記憶體 storage adapter、jsdom 與 fake-indexeddb；它們驗證服務契約與邊界，不等同 Obsidian 實機驗收。
- 沒有模擬 200 個真實網路來源；100,000 規模檢查針對 metadata 分頁、DOM 數與全文按需讀取。
- 遠端圖片離線不保證可用；保存筆記的文字可離線閱讀。
- 插件不處理跨裝置同步衝突，亦不擷取原文網頁或下載附件。


## 後續側欄與主題更新（2026-09-22）

- 依使用者 Feedly 截圖改為直列圖示導覽、資料夾收合、選取狀態及右對齊未讀數；計數只查摘要，不讀全文。
- 全文使用 Obsidian `markdown-rendered`、閱讀字型與主題變數，清除來源 HTML 的樣式／字型覆寫。
- `npm run build` 通過；`npm test` 更新為 62 passed、1 opt-in scale skipped。
- Obsidian 1.13.7 實測收合後讀文章、未讀數 1→0、Default theme 明暗切換；設定已還原 Adapt to system。
- 畫面證據：screenshots/sidebar-dark.png、screenshots/sidebar-light.png；視覺檢查見根目錄 design-qa.md。
- 未新增第三方 theme；未逐一驗證社群 theme，也未重測新增側欄計數在 100k 原生資料的效能。原先規模數字只適用原驗收路徑。


## 後續閱讀流程更新（2026-09-22）

- 由雙欄改為列表→全文；左側選來源會重回列表，標題顯示來源名稱。批次操作收至 Reading actions。
- 全文提供返回列表、上一篇／下一篇；j/k 在全文切文，Esc 返回列表並還原選取位置。跨 50 筆分頁可雙向導覽，連續鍵盤事件依序處理。
- `npm run build` 通過；`npm test` 為 64 passed、1 opt-in scale skipped。
- 實機 Obsidian 1.13.7 驗證來源列表→文章、全域兩篇文章 j/k 切換、Esc 回列表與焦點還原。跨 50 筆邊界由自動測試驗證，實機樣本只有兩篇。
- 畫面：screenshots/reader-list.png、screenshots/reader-article.png。這次沒有重新跑完整 100k 規模或第三方 theme 驗證。


## Reader 關閉後由側欄重開修正

來源點選原先只更新 ReaderUiState，reader 關閉後沒有接收者。新增側欄 onOpenReader 回呼，先更新範圍再開啟／顯示 reader；同時以共用 Promise 防止重複開啟。

回歸測試先確認點來源未觸發 open（0 次），修正後通過。Build 及 65 個一般測試通過。實機關閉 reader、保留側欄，點 Hacker News Daily 已自動重開單一 reader 並顯示該來源 10 篇文章列表。


## 大量來源管理分頁（2026-09-22）

Manage sources 由 Modal 改為主區域 ItemView 分頁，支援單一分頁復用與卸載清理。Sources／Folders 分區、每頁 50 筆、全來源名稱／URL／資料夾搜尋，既有編輯與匯入匯出功能保留。

Build、66 個一般測試通過。200 來源 DOM 測試確認只渲染 50 筆、翻頁至 51–100、從其他頁搜尋到第 200 筆且保留搜尋焦點。實機現有 1 個來源，確認主區域管理分頁、資料夾切換、編輯及返回；未向使用者 vault 注入 200 筆測試訂閱。

## 可設定筆記模板（2026-09-22）

新增檔名／內文模板、自訂 Properties 與設定頁即時 Markdown 預覽；保存時採用同一產生器，保留識別欄位及既有筆記去重。Apply 失敗保留草稿，未知變數／不合法 Properties 不可套用。

- `npm run build` 通過（TypeScript＋esbuild）；workspace `main.js` 已更新。
- `npm test`：15 files、72 passed、1 opt-in scale skipped。
- 新增覆蓋：變數與日期格式驗證、YAML 結構注入防護、必要欄位保護、Markdown metadata escaping、模板更新只作用新筆記，以及設定頁草稿／預覽／驗證／寫入失敗與重試。
- 本次設定頁驗證使用 jsdom 與 Obsidian API mock；未做 Obsidian 實機操作，未更新外部測試 vault 的插件檔案。未重跑規模測試（本次未改快取與列表）。
