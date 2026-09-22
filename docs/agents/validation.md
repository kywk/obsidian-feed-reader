# 驗證與交付規範

選擇驗證、執行檢查或報告完成前讀本文件。

- 功能或修正選擇能驗證使用者行為與資料邊界的測試，避免重述實作；純文件變更檢查內容、連結與 diff 即可。
- 建置與測試命令以 package.json 為準。一般程式變更執行 build 與相關測試；交付完整功能時執行一般測試組。測試通過後，只有新變更、失敗或未解風險才重跑或擴大範圍。
- 影響分頁、metadata／正文分離或大量資料路徑時，評估 opt-in scale 測試；其他變更不例行重跑規模測試。
- 區分 typecheck／build、單元或整合 mock、Obsidian 實機、真實來源互通與規模量測。jsdom、fake-indexeddb 不等於原生 UI、IndexedDB 或網路效能。
- 記錄實際命令、PASS／FAIL／NOT_RUN、測試數與略過項。引用先前結果要標示日期、文件及適用範圍。
- 實機測試記錄 Obsidian 版本、隔離 vault、操作結果與尚未測項。更新 workspace main.js 不代表已安裝到使用者 vault。
- 產品行為更新 README.md；契約更新 SPEC.md；重要驗收證據存 docs，並由 docs/progress.md 連結。歷史紀錄保持原測試時點，不用今日數字覆蓋過去數字。

參考 CMS 的驗證證據分層；未移植 Java／資料庫規則、測試新增限制或協作租約，這些不適用本專案目前流程。
