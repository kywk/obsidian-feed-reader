# 分階段實作計畫

分支：codex/article-fulltext-ai-summary。

1. 規格與介面：保存訪談契約、檔案 ownership、驗證邊界。
2. 核心並行：筆記範圍與轉換、公開正文擷取、本地 CLI adapter，各自針對失敗邊界測試。
3. 整合：Obsidian 命令、選擇與結果對話框、取消、並行寫入保護、共享及本機設定。
4. 驗證與文件：build、一般測試、差異檢查；README 雙語、SPEC、第三方授權與進展索引。未執行實機／真實 CLI 明列。

不修改外部 vault、不發布、不推送。功能階段與驗證先完成，未另獲提交授權時保持工作區可審查。

## 階段成果

1. 已完成：分支、訪談 spec、工作分工與原始碼查證。
2. 已完成：三組核心模組與針對性測試。
3. 已完成：原生元件設定頁、三命令、背景工作及取消、editor/CAS 衝突保護；DOM／adapter mock 驗證。
4. 已完成建置與一般測試，文件及限制見 [validation](validation.md)。真實 CLI／Obsidian smoke 未執行，不混入自動檢查完成宣告。

## 分批提交

使用者於本次開發與實測修正後授權分批 commit。按保存模板與日期、來源對話框、全文／摘要／tags 整合、規格與驗證文件拆分；不 push。各 commit 引用的是拆批前完整工作區 185 passed／1 skipped 與 build PASS，未宣稱每個中間版本皆獨立執行測試。
