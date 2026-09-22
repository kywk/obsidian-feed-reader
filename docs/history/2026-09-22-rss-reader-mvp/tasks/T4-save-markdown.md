# T4 — 保存文章與筆記索引（可直接作 worker prompt）

工作目錄 `/Users/kywk/Dropbox/project/obsidian/feedly`。先讀 models、SPEC S6 與 settings 的保存路徑；PM 附 T2 article API。工具模型由 PM 指定，不委派。只修改 `src/save/**`、`tests/save/**`，依賴與共用檔由 PM 管理。

實作保存 service：取 RSS Article 正文/摘要轉 Markdown，不抓原文、不下載圖片。保留遠端安全圖片連結；無內容仍保存標題/來源/連結并明示缺內容。T3 的 sanitizer 尚未完成時注入 sanitize callback，PM 最後接同一 helper，不另造不同安全政策。

使用設定的 vault-relative 目錄，自動建立必要資料夾，防止跳出 vault。檔名日期＋安全標題，衝突加短 ID，不覆寫任何既有文件。frontmatter 含 feed_reader_id（feedId+articleId）、feed_reader_source_id、來源名稱、原文 URL、發佈時間（有才寫）、保存時間；正確 YAML escaping。

重複 Save 開既有筆記、不改內容；同文章併發 Save 去重，成功寫檔後才登記 saved。寫入失敗可重試。索引 article key→path 可重建；訂閱 vault rename/delete 事件。失效 path 才查 metadata cache，不逐篇讀全 vault 文字。筆記刪除可重存，移動/改名仍能找，取消來源不刪筆記。提供 saved 檢視查詢（不依賴文章 cache 尚存在）。

完成：重複/同時保存、同標題不同文章、特殊字元 YAML、空正文、移動/刪除、IO 失敗與索引恢復有測試；build 通過。回報 exports/save callback/dispose 用法及實際測試。不要為了索引引入獨立資料庫服務。
