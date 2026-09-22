# Signal RSS 實作機制研究

研究日期：2026-09-22。以遠端預設分支 commit `06ae491adc2a795df3af39e2df7537eefe6eebe2` 為準，manifest 版本 0.8.1。以 clone 的 TypeScript 原始碼靜態閱讀，未在 Obsidian 實機測試；以下推論均與實作事實分開。遠端未找到 AGENTS.md。

## 訂閱與文章儲存

- 訂閱與 settings 使用 Obsidian `loadData/saveData`，PersistedData 僅有 `settings`、`feeds`；每個 feed 僅一個 `group` 字串。這是 plugin data.json 中的應用資料，不是以 Markdown/YAML 訂閱檔為權威。[main.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L40-L44)、[載入與保存](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L262-L305)
- 每源一個 JSON，預設 vault `.signal-rss/<feedId>.json`，可自訂資料夾。每篇 Article 同時存 metadata、summary、content、fulltext、read、starred、savedPath。啟動 `loadAll` 把所有訂閱文章全載入 Map；狀態修改使該源 dirty，flush 重寫整份該源 JSON。[types.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/types.ts)、[store.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/store.ts#L182-L261)、[flush](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/store.ts#L427-L443)
- 預設每源保留 200 筆；每次只合併 feed 前 300 筆、按 publishedAt 新到舊截斷，不保護 starred/read/savedPath。文章 ID 是 guid → link → title 的自製 hash；summary/content 各截至 200,000 字元，但 fetch 出來的 fulltext 不走此截斷。[合併邏輯](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/store.ts#L323-L376)、[預設值](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/types.ts#L131)

## 已讀與同步

- 每篇文章的布林 read/starred 與文章內容同檔保存。沒有與內容分離的已讀 tombstone、readBefore 時間界線或逐筆修改時間；文章被容量裁切時狀態也隨之消失。[Article](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/types.ts#L14-L29)、[裁切及狀態更新](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/store.ts#L369-L406)
- 在本次檢視的主入口沒有 vault 外部 cache 修改監聽或跨裝置合併協定；loadAll 只在啟動、reset、切換/遷移 cache 呼叫。推論：檔案可交給同步工具搬運，但不能將此視為即時多裝置閱讀狀態協調；同步是否包括隱藏資料夾亦取決於同步工具設定。[main.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts)
- `combineCachedArticles` 的 read/starred OR 合併僅用於手動 cache 資料夾 migration，不是常態跨裝置合併；OR 也不是可表示「較新標記未讀」的衝突策略。[migration merge](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/store.ts#L137-L176)
- README 宣稱 read/starred 存 data.json 與程式不一致，本研究採程式為準。[README 資料位置](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/README.md#where-data-lives)

## 抓取與排程

- `requestUrl` 直連 feed/文章 URL，無第三方聚合服務。HTTP timeout 用 Promise.race，預設 20 秒，timer 自 request 發出時計時；逾時並不 abort 底層 request。本次來源沒有 ETag/If-Modified-Since/304 專門處理。[fetcher.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/fetcher.ts#L31-L81)
- 全源/群組刷新以 3 workers 從 queue 取 feed；timer 在 plugin onload 啟動，預設 60 分鐘，0 關閉，不依賴 reader view 是否存在。啟動僅載 cache，並未即時先 refresh。[onload](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L127-L163)、[排程](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L440-L454)、[workers](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L1059-L1099)
- 支援 RSS/Atom/RDF。新增網址先嘗試作 feed；失敗時讀 HTML 找 feed link，再嘗試慣用路徑；網路不可達直接退出。[discoverFeed](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/fetcher.ts#L112-L147)、[parser.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/parser.ts)

## 全文與內容安全

- 自製 readability-style heuristic：DOMParser 解析頁面，移除 nav/header/footer 等雜訊，用文字長度、連結懲罰、tag/class 提示與段落加權選正文；不足 200 字元放棄。沒有執行網頁 JavaScript 的 renderer。推論：動態內容與需登入的原頁不保證可擷取。[fulltext.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/fulltext.ts)
- 打開文章自動抓全文預設 true，只要無 fulltext、無 fulltextFailed、有 link 即抓，不檢查 feed 正文長度。refresh 抓全文預設 false；開啟時僅在新增文章後處理最近 20 篇，跳過已有/已失敗、feed 正文純文字 >1200 字者，各篇依序 await。[open](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/view/feed-view.ts#L93-L108)、[batch](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L1123-L1173)
- 失敗會保存 fulltextFailed，往後自動流程跳過，可用手動按鈕 force 重抓。顯示/保存優先 fulltext → content → summary。[全文抓取](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L1149-L1178)、[手動抓取](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/view/feed-view.ts#L260-L268)
- 自製 tag/attribute allowlist 清理，再用 Obsidian sanitizeHTMLToDom 插入 DOM；Markdown 轉换也自製，支援表格/清單/程式碼等。圖片保持 URL，並非下載成 vault attachment。[sanitize.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/sanitize.ts)

## 筆記與 UI

- 可自訂資料夾、檔名、frontmatter、body 模板；預設 RSS Inbox。每次保存用 uniquePath 建立新檔，同名加 2、3；savedPath 只記錄最近結果，沒有既存筆記索引或避免重複保存。[saver.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/note/saver.ts#L107-L165)、[saveArticle](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L1175-L1191)
- 搜尋/群組/訂閱樹/文章列表在右 sidebar，正文在主區 reader tab；all/unread/starred 篩選。搜尋 title/author/summary，不搜 fulltext；include/exclude keywords 也是顯示篩選，不阻止抓取與儲存。[visibleRefs](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L486-L506)、[filter/query](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/core/store.ts#L92-L117)
- 列表直接 for-of 渲染所有 filtered refs，無 cursor paging 或 virtualization；推論在多源多文章時，記憶體、排序與 DOM 成本高於 metadata 分頁架構。[list-pane.ts](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/view/list-pane.ts#L430-L465)
- manifest 聲明支援手機，UI 有 mobile sidebar 收合流程；這是程式與宣告證據，非實機驗證。[manifest](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/manifest.json)、[selectArticle](https://github.com/hellokunzai/obsidian-signal-rss/blob/06ae491adc2a795df3af39e2df7537eefe6eebe2/src/main.ts#L546-L566)

## 對照時應保留的界線

Signal 的功能強項是站點 feed discovery、全文抓取、starred、完整 sidebar 操作與可自訂筆記模板。其資料架構採全部文章與狀態集中於每源 JSON、啟動全載入、整份重寫，適合用檔案備份，但不能推論具有衝突安全同步。比較本地 feedly 時，應把「功能完整度」與「資料分層、同步策略、分頁擴展性」分別衡量；不能只以 README 的功能數量判斷架構優劣。
