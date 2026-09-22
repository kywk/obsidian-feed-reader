# T3 — Reader UI 與鍵盤（可直接作 worker prompt）

工作目錄 `/Users/kywk/Dropbox/project/obsidian/feedly`。PM 已完成 T1/T2，應附相關服務 exports。先讀 `src/ui/views.ts`、`src/domain/models.ts`、SPEC S5/S6，再讀實際要呼叫的 service exports。不要讀其他 worker history。缺前置 API 時通知 PM，不複製另一份 data layer。

擁有 `src/ui/views.ts`、`src/ui/reader/**`、`src/ui/content.ts`、`styles.css`、`tests/ui/**`；不改 main/settings 或其他 workers 檔案。套件與 shared types 由 PM 處理。

用原生 Obsidian ItemView/DOM 做左側來源＋單層多歸屬資料夾，主區域列表＋文章內容。全部/已讀/未讀/今日/已保存入口，來源與資料夾範圍的狀態篩選、標題搜尋、日期降序。今日採本地日期與 publishedAt fallback firstFetchedAt。列表分批載入 metadata，選取才取全文；全域多分類去重。已保存資料由 T4/PM 接入，先提供 callback，不把 fixture 當產品資料。

快捷鍵 j/k 移動，Enter 開內容，o 開 HTTP(S) 原文，m 切已讀，s 呼叫 save callback，Esc 返回。僅 reader 焦點處理，輸入元素/contenteditable/IME 不攔。開正文即讀；可選 j/k 移入即讀，選項預設 false。內容開啟時 j/k 同步切文。未讀列表保持剛讀文章，直到重新篩選/切來源；背景刷新不讓焦點跳動。

內容使用可靠 sanitizer，移除 script/iframe/事件屬性/危險 URL，解析相對 URL；在 `src/ui/content.ts` 匯出可供保存共用的淨化 helper。空、載入、失敗狀態要可見。分類 CRUD 與 import dialogs 由 T5 在 manage/ 做，這裡提供操作入口 callback。

完成：焦點/IME、無選取、已讀後列表穩定、今日時區、惡意 HTML、分批渲染有針對性測試；build 通過。回報 view 建構方式及需要 PM 接入的 callbacks，避免以服務尚未實作為理由另造契約系統。
