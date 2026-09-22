# T6 — MVP 驗收（可直接作 worker prompt）

工作目錄 `/Users/kywk/Dropbox/project/obsidian/feedly`，前置 T5。只讀 SPEC S7、README 開發指令與 PM 提供改檔/exports 摘要；失敗後再深入對應模組。寫 `tests/acceptance/**`、本 history 的 `mvp-validation.md`，產品修正先和 PM 確認檔案 ownership，無需再讓使用者批每個 fix。

執行 build/tests，檢查一條 RSS 與一條 Atom 的新增→閱讀→m→s→重啟→再開筆記流程。覆蓋 YAML/TOML 合併/取代及破損外改、多資料夾共享狀態、cutoff 後補舊文/未讀例外、500 淘汰/重新訂閱、輸入欄不攔快捷鍵、惡意 HTML/URL、重複保存與移動筆記、寫入失敗、離線更新、關閉 reader/unload 後無更新。

合成 200×500 metadata，記錄測試環境、列表首批載入耗時、DOM 列数及全文讀取數，確認沒有載入 100k 全文/DOM。無需模擬 200 個真實網路來源，不增加微基準框架。以資料不丟失/可閱讀/不覆寫/不凍結為優先。

有 Obsidian 測試環境就做實機 smoke，記版本、步驟及觀察。沒有時明確列未驗證項，保留可直接執行的短 checklist；不可把 unit tests 當作實機驗收。回報 P0/P1 blocking 與其他差異，PM 分派必要修正後針對性複驗，不因範圍外需求阻擋 MVP。完成後由 PM 更新 README 功能狀態。
