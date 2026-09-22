# T2 — Feed 抓取與本機快取（可直接作 worker prompt）

工作目錄 `/Users/kywk/Dropbox/project/obsidian/feedly`。實作桌面 Obsidian RSS/Atom 抓取與本機 cache；模型工具由 PM 指定，不再派 agents。只讀 `src/domain/models.ts`、SPEC S1/S4 及直接需要的 API 文件，不讀全部 history。

擁有 `src/feeds/**`、`src/cache/**`、对应 tests 與 `tests/fixtures/feeds/**`。package/lockfile/models 交 PM，套件需求回報 PM 安裝。

輸入為 FeedSource，沿用 feedId。透過 Obsidian requestUrl 或可替換 transport 取公開 HTTP(S) URL，支援 RSS/Atom namespaces/相對網址/缺日期/缺正文。只解析不執行 HTML。文章 ID 優先 GUID/Atom ID，其次 URL，再穩定欄位 digest；來源內去重，跨來源不合併。更新保持 firstFetchedAt、不操作已讀與保存筆記。

快取使用 IndexedDB，vault 身分＋feedId 分區，metadata 與全文可分開讀。不要寫 vault 或 plugin folder。每來源保留最新 500 篇；沒有有效 publishedAt 用 firstFetchedAt；刪 source cache 不刪 vault state。提供分頁 metadata 查詢、全文按 ID 取得、upsert、刪來源與 dispose。目標 200×500，不每次查詢掃讀全部全文。

刷新服務限制併發（起始 4）、同來源在途去重、逾時、部分失敗保留既有 cache 並回報每來源錯誤。adapter 不可取消時忽略逾時後結果並避免無界重試。scheduler/readers 計數由 T5 做，本任務只供 refresh/query API。

完成條件：RSS/Atom fixtures、重抓與更新 ID、缺欄位、firstFetchedAt 穩定、錯誤保留 cache、500 淘汰、vault 隔離、metadata 查詢不載全文的測試。用 fixtures 不依賴即時網路。build 與 tests 通過，回報 exports、schema/index 與最短使用例、未驗證實機事項。不加入 sync/登入/全文抓取。
