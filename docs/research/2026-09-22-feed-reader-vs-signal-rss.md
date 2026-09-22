# Vault Feed Reader 與 Signal RSS 機制比較

比較日期：2026-09-22。本地以目前 workspace 原始碼為準（此目錄不是 Git repository）；Signal RSS 以 `06ae491adc2a795df3af39e2df7537eefe6eebe2`、manifest 0.8.1 為準。這是靜態原始碼比較，沒有執行 Signal 實機或雙方效能基準測試。

## 結論

Signal 的閱讀產品功能較完整；本地專案的優勢是可編輯訂閱、閱讀狀態獨立保存、metadata/正文分離及筆記身分追蹤。若延續大量訂閱、vault 內資料自主的需求，適合保留現有架構並借鑑 Signal 功能，不宜直接改成其整批 JSON 快取模型。

## 機制對照

| 面向 | 本地 Vault Feed Reader | Signal RSS | 意義 |
|---|---|---|---|
| 訂閱權威 | vault YAML，UI 回寫，外部修改監看，損壞保留 last-good 並停寫 | plugin data.json 保存 settings/feeds | 本地適合文字編輯與版控；Signal 以 UI 操作為主 |
| 分類／交換 | 單層多對多資料夾；YAML/TOML | 每 feed 單一 group；OPML；首頁找 feed | 本地分類彈性較高，Signal 接軌其他 reader 較方便 |
| 文章儲存 | IndexedDB，metadata/content 分 store，正文按需讀 | vault .signal-rss/<feedId>.json，內容與 read/starred/savedPath 共存，啟動 loadAll 到記憶體 | 本地避免正文進 vault 同步；Signal 快取能隨檔案搬移，但是否同步取決於同步工具設定 |
| 留存 | 每源 500 篇 | 預設每源 200 篇，可調 | 兩者都不是完整歷史封存 |
| 已讀 | 每源 JSON 的 readBefore/readIds/unreadIds，獨立於文章淘汰 | article.read 布林值，批次操作修改已載入文章 | 本地 cutoff 會涵蓋後補舊文，且手動未讀可覆蓋；Signal 狀態依附留存文章 |
| 跨裝置 | 監看 vault 狀態修改、重讀；不合併衝突 | 未見外部資料變更監看／跨裝置衝突合併 | 不能把任一方稱為完整多裝置同步引擎 |
| 列表規模 | 50 筆 cursor 分頁、正文按需讀 | 篩選記憶體文章後全部建 DOM rows | 本地較適合大量文章的設計；不能據此宣稱實測速度勝出 |
| 更新 | reader 存在時 30 分鐘；4 併發；請求與排隊各有 15 秒 timeout | plugin 啟用期間 timer；預設 60 分鐘可調／停用；3 workers；預設 20 秒請求 timeout | Signal 可背景收文；本地大量來源可能在真正發出前排隊逾時 |
| 正文 | 僅 feed 內文／摘要 | 額外 GET 文章 URL，自製全文抽取；開文自動抓預設開啟；刷新預抓預設關閉 | Signal 對摘要型 feed 較實用，但增加網路、解析失敗與快取成本 |
| 保存 | YAML serializer + Turndown；穩定 frontmatter ID；重存開既有筆記，追蹤 rename/delete | 可自訂檔名、frontmatter、body 模板；每次建立 uniquePath 新筆記 | Signal 客製性高，本地避免重複筆記與人工內容覆寫 |
| 搜尋／閱讀 | 標題搜尋；今日／已讀／未讀／已保存；j/k 等鍵盤流程 | 標題／作者／摘要搜尋；星號；右側來源與列表、主區正文 | 各有取向；星號不等同永久保存 |
| 平台 | desktop-only、目前主要介面英文 | 宣告 mobile 支援，手機 drawer／long-press，en/zh-cn | 手機與在地化是本地明顯缺口；本次沒有實機驗證 Signal |

Signal README 說 read/starred 位於 data.json，但目前原始碼 persist() 只寫 settings/feeds，read/starred 是 Article 欄位，隨每來源快取 JSON 保存；本比較以原始碼為準。cache migration 的 read/starred OR 合併僅用於搬移快取資料夾，不是一般同步機制。

## 本地需要先補強的地方

1. **更新佇列**：refreshSources 一次提交所有來源，queue timeout 從入隊即開始。4 併發下，若大量請求耗時，後面來源可能未發出就 15 秒逾時。可採 Signal worker 拉取工作，讓 request timeout 從實際工作開始，再獨立設合理的批次取消策略。
2. **未讀統計**：SourcesView.updateCounts 在刷新時逐來源掃描摘要；collectMatchingPage 搜尋／狀態篩選也可能掃過大量 metadata。列表只有 50 DOM 不代表整個 UI 都只有 50 筆成本。應加入增量計數與相應量測。
3. **既有驗證範圍**：本地 100k 驗證使用 jsdom/fake-indexeddb，不能視作原生 Obsidian 100k 效能；後增側欄計數也未重測原生規模。

接著優先補 OPML（不改 YAML 權威）、首頁 feed discovery、可選全文擷取；再視需求加入筆記模板、作者／摘要搜尋、星號、手機與 i18n。若加模板，應保留必要穩定身分 frontmatter 與既有筆記追蹤。

## 原始碼與驗證來源

本地：

- [訂閱服務](../../src/subscriptions/service.ts)、[資料形狀](../../src/domain/models.ts)
- [IndexedDB](../../src/cache/indexeddb-cache.ts)、[閱讀狀態](../../src/read-state/service.ts)、[外部狀態監看](../../src/main.ts)
- [刷新服務](../../src/feeds/refresh-service.ts)、[scheduler](../../src/scheduler.ts)
- [UI 分頁、搜尋、計數](../../src/ui/views.ts)
- [保存服務](../../src/save/service.ts)、[Markdown](../../src/save/markdown.ts)
- [MVP 驗證範圍](../history/2026-09-22-rss-reader-mvp/mvp-validation.md)

Signal，固定 commit：

- [main：持久化、排程、更新、全文、保存](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts)
- [store：cache／讀取／狀態／淘汰](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/store.ts)
- [types：設定預設與資料形狀](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/types.ts)
- [list-pane：列表建立與分類](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/view/list-pane.ts)
- [全文抽取](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/fulltext.ts)、[feed fetching/discovery](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/fetcher.ts)
- [note saver](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/note/saver.ts)、[README 功能／手機說明](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/README.md)
