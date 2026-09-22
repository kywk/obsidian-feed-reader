# Obsidian UI 與生命週期

修改 views、設定、styles、main 或事件／timer／request 生命週期時讀本文件。

- 沿用 Obsidian 原生元件、圖示及 theme 變數，正文與筆記閱讀字型保持一致。修改樣式檢查明暗模式；第三方 theme 未測就明列未測。
- 來源側欄、reader 與管理頁各自負責導覽或操作；重複開啟沿用既有分頁，reader 關閉後來源點擊可重開。
- 列表到正文的切換保留選取、返回位置與焦點。鍵盤操作只在 reader 有焦點且不在輸入欄或 IME 組字時生效；圖示操作提供可讀名稱。
- 長清單維持分頁；搜尋輸入避免因重繪失焦。非同步操作需保留錯誤通知與草稿，防止重複提交。
- Subscribe、DOM event、timer、observer 與 request 都要有明確 owner 與 close／unload 清理路徑。非同步完成先確認 view／plugin 仍有效。
- reader 存在與目前是否前景是不同狀態；更新生命週期沿用 SPEC，不讓切到筆記停止既有排程，最後 reader 關閉應停止排程。
- 設定草稿只有 Apply 成功才視為保存；路徑或設定寫入失敗保留可恢復狀態。
- 最低 Obsidian 版本、桌面限制與發布版本以 manifest 及實際 API 相容性核對；支援手機須獨立處理現有 FileSystemAdapter 等假設。
- 原生 smoke 使用獲授權的隔離 vault，記錄版本與操作。模擬 UI 測試不等同成功安裝、下載或實機快捷鍵驗證。
