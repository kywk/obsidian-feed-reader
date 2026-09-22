# 驗證紀錄

## 18:24 AI 摘要同時產生 tags

摘要同次請求產生 JSON summary/tags，合併既有 frontmatter tags（文字或文字清單），忽略大小寫去重，保留其他 Properties／正文。無 frontmatter 時新增；無效模型格式／不相容 tags 保留原筆記。自訂 CLI 輸出契約同步更新為 JSON，內建 provider 外層協定不變。

npm run build PASS；npm test 26 files、185 passed、1 opt-in scale skipped；diff check PASS。新增解析／tag 驗證、合併／去重／Properties 註解保留、錯誤不部分寫入測試。已備份並安裝 obs-feedly 三檔且雜湊一致；未以真實模型執行本次 JSON 互通，待使用者重新啟用測試。

## 18:16 摘要背景取文與內容保留

依使用者新要求：摘要無全文（含空區塊）自動背景抓取，只寫摘要、不寫全文；取消舊版缺全文選項。整正文規則只供摘要輸入，不能取代整份筆記，全文另加於末尾。新增與重跑測試驗證摘要在前、全文在後、未知正文／同級區塊保留、管理區塊取代且不重複。

npm run build PASS；npm test 25 files、180 passed、1 opt-in scale skipped；diff check PASS。README 雙語與 SPEC 已更新，obs-feedly 三個程式檔已備份／安裝並驗證雜湊；未修改真實筆記內容。原生流程仍待使用者重新啟用後確認。

## 日期 Properties／新增來源對話框後續驗證

2026-09-22：全套 npm test 25 files PASS，178 passed、1 opt-in scale skipped；最後收斂既有來源編輯分支與網路錯誤遮罩後，typecheck 及相關 28 項測試 PASS；root 最終 npm run build PASS。新增日期遷移／新舊筆記索引／失敗不遷移、feed title 擷取及 Modal UI 操作驗證。

已更新 obs-feedly 插件三檔並比對 SHA-256，設定與文章保留，舊版程式檔暫存備份。尚待使用者重新啟用後原生驗收；未批次遷移真實文章。行為與分工詳見 [調整記錄](note-dates-source-modal.md)。以下較早紀錄保持原測試時點。

日期：2026-09-22。分支：codex/article-fulltext-ai-summary。範圍為本次完整工作區，未分別宣稱每個開發階段皆獨立建置。

## 自動檢查

| 檢查 | 結果 | 範圍 |
|---|---|---|
| npm run build | PASS | TypeScript 與正式 bundle，含第三方 notices |
| npm test | PASS | 22 test files；156 passed、1 opt-in scale skipped（17:21） |
| git diff --check | PASS | 已追蹤差異無 whitespace 錯誤；另檢查新檔 |
| 文件相對連結 | PASS | README 雙語/SPEC/進展索引/本次歷史文件的本地連結均存在；新檔 whitespace 通過 |

新增驗證包含原文規則／管理標記／同名摘要標題、frontmatter／URL、HTML 擷取與清理、取消／逾時、錯誤回應、三命令與起始筆記綁定、多 editor 未儲存 buffer、重複工作、CAS 衝突、設定 DOM 草稿／Apply／保存失敗、四框架輸出協定。

真正本地 Node 子程序 4 項測試：stdin 內容、非 shell 字串、UTF-8 串流、cwd/PWD 暫存隔離與清除、非零退出、取消／逾時後程序停止。未呼叫模型、未讀取真實 vault。其他 CLI 測試使用 mocked spawn。

## 未執行／限制

- NOT_RUN：Obsidian 原生命令面板、設定、明暗主題、編輯器 undo／自動落盤與多分頁 smoke；未安裝到使用者外部 vault。
- NOT_RUN：四個真實 CLI 已登入版本與模型端到端互通；mock 不代表真實版本支援通過。設定提供測試入口供實機驗收。
- NOT_RUN：公開真實網站 HTTP 互通、登入／JS 網站；擷取使用 fixtures 驗證。Readability 抽取成功不代表網站提供完整內容。
- NOT_RUN：Windows 原生程序控制、子孫程序終止；.cmd shim 不支援直接啟動。
- NOT_RUN：100k scale，本次未更動 reader metadata／正文查詢與分頁路径。
- requestUrl 不提供最終轉址 URL，整合中相對連結採起始 URL；無法保證取消底層下載，5 MiB 在緩衝下載後才檢查。
- 暫存 cwd 不等同完整作業系統 sandbox。全域 CLI/MCP、自訂工具及參數仍需可信；CLI 可以使用雲端模型。
- 開啟筆記的更新成功是 editor 操作成功，落盤沿用 Obsidian 自動保存；關閉筆記等待 vault.process 完成。

## 後續原生驗收步驟

### 17:43 使用者實測 Save 錯誤修正

使用者於 obs-feedly 按 Save/open note 回報 `Templates must be text`。以完整插件設定作為 templates callback 的保存服務測試重現；原因是 validateNoteTemplates 用 Object.values 驗證所有設定，將 markReadOnNavigate 布林值與 enrichment 物件誤當模板。改為只驗證三個 NoteTemplates 欄位，仍拒絕缺少或非文字模板。新增保存／重開保留人工編輯、三欄型別防護回歸。

修正後 npm run build PASS；npm test：22 files、158 passed、1 opt-in scale skipped。已備份並更新 obs-feedly 的 main.js/manifest.json/styles.css，SHA-256 比對一致，未修改 data.json 或文章。需使用者重新載入插件後再確認實機操作；不宣稱原生 Save 已驗收。

1. 在另行授權的隔離 vault 安裝建置產物，記錄 Obsidian/CLI 版本。
2. 開啟 Feed 筆記與 Web Clipper 筆記，檢查三命令只在 Markdown 可用，reader 無新增操作。
3. 設定兩組原文 heading、property 全文條件、URL 衝突，確認選擇／附加／取代及 Properties 保留。
4. 設定已登入本機 CLI，按測試後摘要；逐工具記錄實際版本與結果。
5. 摘要途中修改正文、切換筆記、取消及停用插件，檢查未誤覆寫／未遲到更新。
6. 多分頁開同檔，確認未存文字保護與 undo；重開 vault 驗證共用／本機設定各自保存。
