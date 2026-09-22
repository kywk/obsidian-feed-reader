# 後續調整：日期 Properties 與新增來源對話框

使用者要求：新增 date_created/date_updated，移除 feed_reader_saved_at/feed_reader_first_fetched_at；Add source 改彈出對話框，僅填 URL 時嘗試取得 title。

## 實作

- 新保存筆記 date_created/date_updated 初始皆使用保存時 UTC ISO 時間，保留 Properties 防止模板覆蓋。
- 索引兼容新舊日期，不造成既有保存筆記被遺忘／重存；不批次改歷史筆記。
- Feed 筆記明確執行全文／摘要更新時遷移舊日期，保留建立時間並更新 date_updated；Web Clipper 日期不變，錯誤／取消不寫部分遷移。
- Add source 以 Modal 保留列表，支援 URL、可省略的 Title 與多資料夾。
- title 擷取沿用 FeedTransport，接受 RSS/Atom feed-level title，15 秒逾時、大小界線、禁止 DTD/entity。手填優先；失敗留草稿，可手填重試。關閉取消並忽略晚到結果。
- root 負責日期、文件與整合；source_modal 子 agent 負責 Modal、title helper 及 UI/解析測試。

驗證結果補記於 [validation](validation.md)；mock UI 不等同原生 Obsidian 通過。
