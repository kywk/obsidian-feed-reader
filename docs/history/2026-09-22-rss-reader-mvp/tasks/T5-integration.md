# T5 — 接線與可用 MVP（可直接作 worker prompt）

工作目錄 `/Users/kywk/Dropbox/project/obsidian/feedly`。前置 T1–T4，PM 提供實際 exports 摘要。讀 `src/main.ts`、`src/settings.ts`、SPEC S2/S4/S5/S7 及各服務入口即可；不重讀全部 history。可由 PM 自己執行，不必另起 agent。

擁有 main/settings、`src/ui/manage/**`、`src/scheduler.ts`、整合測試。其他檔必要修正由 PM 協調 ownership。將資料、抓取、views、保存接成新增→更新→讀取→保存的真實流程；無假資料或永遠 loading 的 callback。先跑一個 RSS 再完成控制項。

管理介面提供新增/編輯來源、單層資料夾 CRUD、多歸屬勾選、解除關聯與全域取消訂閱的區分、YAML/TOML 匯出及合併/取代匯入；取代確認，解析錯誤保留 last-good 並禁寫。批次已讀提供目前來源/資料夾/全域範圍與日期以前截止，不因搜尋只看部分文章而誤解操作範圍。

設定接入 subscriptions YAML 路徑、保存目錄、j/k 已讀。路徑變更驗證、切換服務监听，錯誤保留舊設定並提示。reader 首開刷新、存在時每30分鐘、最後關閉停止，休眠醒來最多補一輪；插件卸載清理 timer/listener/database handles，晚到結果不再改 UI。重複 ribbon 復用 leaves；工作區恢復已有 reader 時也正確啟動。更新失敗有每來源提示、既有文章可讀。

整合 sanitizer→render/save，共享 source ID，將 saved 索引提供給已保存檢視。首次功能測試存在後移除 package test 的 passWithNoTests。完成 build/test 並在可用 Obsidian 測試 vault smoke；若未有 GUI 測試條件，明列未驗證而不宣稱完成 S7。回報真實操作路徑、結果與剩餘 blocking issues；一般實作決定自主處理，不新增契約審核。
