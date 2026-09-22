# Vault Feed Reader

[English](README.md)

Obsidian 桌面版 RSS／Atom reader。訂閱、閱讀狀態與保存筆記留在 vault；文章內容快取存在本機 IndexedDB。

0.3.0 新增英文與繁體中文介面，可跟隨 Obsidian 語言或手動選擇。

## 介面語言

支援英文與繁體中文，涵蓋閱讀器、訂閱管理、設定與命令。在「設定 → Vault Feed Reader → 語言」選擇「跟隨 Obsidian」（預設）、English 或繁體中文；變更後請停用並重新啟用插件。不支援的 Obsidian 語言會使用英文。

介面語言不會翻譯來源內容、來源／資料夾名稱、既有筆記、模板或摘要提示詞。解析器、儲存與外部工具的技術錯誤訊息可能保留原始語言。

## 目前狀態

MVP 與 OPML 匯入／匯出已實作；OPML 完整工作區 build 與 90 個一般測試通過，1 個 opt-in scale 略過。OPML 尚未做 Obsidian 實機或真實匯出檔互通驗證，詳見 [OPML validation](docs/opml-validation.md)。先前 MVP 實機流程與 2 個模擬規模測試見 [MVP validation](docs/history/2026-09-22-rss-reader-mvp/mvp-validation.md)，未驗證項不視為通過。

開發前閱讀 [AGENTS.md](AGENTS.md)；提交與驗收規範由該檔按需導引。歷次成果與提交脈絡見 [進展索引](docs/progress.md)。

0.2.0 新增筆記全文擷取與本機 CLI 摘要；驗證範圍見[本次紀錄](docs/history/2026-09-22-article-enrichment/validation.md)，尚未驗證原生 Obsidian 與真實模型互通。

## 開發與本機安裝

使用 Node.js 22：

```sh
npm ci
npm run build
npm test
# 選用：100k 摘要規模測試（耗時約數分鐘）
npm run test:scale
# 持續編譯
npm run dev
```

將 `main.js`、`manifest.json`、`styles.css` 複製到測試 vault 的 `.obsidian/plugins/vault-feed-reader/`，在 Settings → Community plugins 啟用 **Vault Feed Reader**。更新檔案後停用再啟用插件。已提交社群目錄；0.1.0 與 0.1.1 未通過自動審查，0.1.2 進一步移除重複外掛名稱的設定標題，0.1.2 自動審查已完成；0.2.0 需獨立審查。可由 [GitHub Releases](https://github.com/kywk/obsidian-feed-reader/releases) 手動安裝；驗證範圍見[審查修正記錄](docs/community-review-validation.md)。

## 閱讀流程

1. 按 ribbon 的 RSS 圖示，或執行 **Open RSS reader**，開啟來源側欄與主區域 reader。
2. 在 **Manage sources** 新增公開 HTTP(S) RSS／Atom URL，設定來源名稱及單層資料夾。每個來源可屬於多個資料夾。
3. reader 分頁關閉後，點左側來源會自動重開；已存在則切回同一分頁。點左側來源後，右側先顯示該來源的全寬文章列表；點文章進入全文，開啟內容即標為已讀。可切換全部、未讀、已讀、今日或已保存，並依來源／資料夾與標題篩選。
4. 按 `s` 保存 RSS 正文或摘要為 Markdown；已保存過則開啟原筆記，不覆寫人工編輯。已保存清單不依賴文章快取仍存在。

管理來源、更新與將此範圍標為已讀改為「訂閱來源」標題右側的圖示按鈕，滑鼠停留可查看名稱。閱讀器隱藏額外的 Obsidian 檢視標題列，保留更多內容空間。閱讀區寬度充裕時，固定導覽列中央會以粗體顯示文章標題；往下捲動後，右下角出現「回到頁首」按鈕。全文上方提供 **Back to list**、**Previous**、**Next**；`Esc` 返回列表並保留選取位置。搜尋、篩選和 **Reading actions** 批次操作留在列表畫面。

文章操作採用短標籤並維持單列，窄視窗可水平捲動，滑鼠停留可查看完整說明。文章操作附有圖示，並提供「複製原文網址」與「複製 Markdown 連結」（`[title](origin-url)`）。僅於有效 HTTP(S) 原文網址存在時顯示複製按鈕，並提示複製成功或失敗。

列表每頁最多 50 筆，全文按需讀取；`j/k` 可跨頁前進及返回。每來源保留最新 500 篇；快取淘汰不刪閱讀狀態或筆記。未讀列表中的剛讀文章會保留到重新套用篩選或切換來源。

| 快捷鍵 | 動作 |
|---|---|
| `j` / `k` | 下一篇／上一篇；正文已開啟時同步切文 |
| `Enter` | 開啟選取文章 |
| `o` | 在外部瀏覽器開 HTTP(S) 原文 |
| `m` | 切換已讀／未讀 |
| `s` | 保存／開啟既有筆記 |
| `Esc` | 返回列表 |

快捷鍵僅在 reader 有焦點且不在輸入欄或 IME 組字時生效。設定 **Mark read on j/k navigation** 預設關閉。

## 訂閱與閱讀狀態

YAML 是唯一訂閱權威來源。UI 修改回寫 YAML；支援 YAML／TOML／OPML 匯入與匯出，匯入預設合併，取代需確認。合併依 URL 去重並保留既有分類與來源 ID；不同 query 不會合併。

外部修改 YAML 會自動載入。檔案損壞時顯示錯誤、沿用最後有效清單並停止 UI 回寫，修正後恢復。來源 URL 是身分的一部分；需要換 URL 時請新增來源，名稱與分類可以直接編輯。

從資料夾移除只解除關聯；取消訂閱才全域移除來源與本機快取。刪除資料夾保留來源，未歸類來源顯示於 Unfiled。重新訂閱同一 URL 會沿用原 ID 與已讀紀錄。

批次已讀針對目前來源、資料夾或全域，與標題搜尋無關。日期以前操作使用本地日期起點，嚴格早於該時間才算已讀；手動標未讀會覆蓋 cutoff，直到再次明確標已讀。

| 資料 | 預設位置 |
|---|---|
| 訂閱 YAML | `Feed Reader/feeds.yaml`，可設定 |
| 每來源已讀 JSON | `Feed Reader/state/<feedId>.json` |
| URL／來源 ID 對照 | `Feed Reader/state/source-ids.json`，保留重新訂閱身分 |
| 保存筆記 | `Feed Reader/Articles/`，可設定 |
| 文章 metadata／正文 | 本機 IndexedDB，依 vault 路徑與來源分區 |

備份時保留 vault 中的訂閱、state 與筆記。IndexedDB 可重新抓取重建，不作為歷史文章封存。插件不處理跨裝置衝突合併。

## 更新與內容

開啟 reader 時更新；只要任一 reader 分頁仍存在，每 30 分鐘更新一次，切到筆記也會繼續。最後一個 reader 關閉後停止排程，休眠過期只補一輪。可手動更新；單一來源失敗保留其既有文章並顯示錯誤。

reader 使用 feed 自帶正文／摘要；獨立筆記命令可擷取公開原文網頁，不登入文章網站或下載附件。渲染、保存與全文擷取共用 DOMPurify／HTTP(S) URL 規則。圖片保留遠端 URL，離線可讀已保存文字，圖片不保證可用。

## 筆記全文與 AI 摘要

開啟 Feed 保存或 Web Clipper 產生的 Markdown 筆記，在 Obsidian 命令面板（macOS 預設 `Cmd+P`）執行：

- **抓取原文全文**：取代已辨識的原文區塊；沒有則附加於文末。
- **產生 AI 摘要**：摘要全文；未辨識全文時，背景擷取後只寫入摘要，不附加全文。
- **抓取全文並摘要**：先抓取再摘要；任一步驟失敗保留原筆記。

命令不在 reader 下執行，不改變閱讀狀態、快取或原有 Save 行為。

設定的 **文章全文與 AI 摘要** 可調整網址欄位（預設 `feed_reader_url`、`source`、`url`）、多組標題規則及順序，或用 Properties 欄位／值將整份正文視為全文。Web Clipper 預設 `source` 且正文無標記，請依模板設定全文條件；僅有網址不代表已含全文。第一個符合規則優先，多個區塊或網址會提示選擇。支援 fenced code 之外的 `## 原文` 類型標題，到下一個同級／更高級標題為止。

新區塊加入隱藏 HTML 註解標記。重新抓取只取代已辨識全文區塊內的內容，保留其餘原文、未知區塊與 Properties。「整份正文」規則只選擇摘要輸入，不授權取代整份筆記；沒有全文區塊就附加於文末。附加標題預設 **原文**；摘要置於文章前的 **AI 摘要**，重跑取代。預設繁體中文概述＋3–5 重點，提示詞可設定。全文辨識只決定文字範圍，無法保證網站回傳的是完整文章。

**本機 Agent** 提供 Codex、Claude Code、OpenCode、pi 偵測、預設選擇、執行檔與完整參數編輯，以及自訂 CLI。修改後先套用，再重新偵測；內建的非互動／輸出格式參數應保留。自訂 CLI 從 stdin 接收提示與文章 JSON，stdout 依要求輸出 `{"summary":"Markdown 摘要","tags":["主題"]}` JSON。需自行安裝並登入 CLI；模型沿用其預設設定。**測試**會用不含筆記的測試文字呼叫模型，可能使用額度。偵測成功只代表找到可執行檔。

Agent 路徑、參數、預設與偵測結果存於此裝置的 vault 專用 localStorage；提示詞與規則存於插件設定。macOS/Linux 偵測包含常見安裝路徑；Windows `.cmd` shim 不能直接執行，需原生執行檔或相容 wrapper。四框架目前驗證為 mock 協定測試，真實版本與 Obsidian 原生操作仍待驗證，詳見[本次驗證](docs/history/2026-09-22-article-enrichment/validation.md)。

工作背景執行，通知提供 **取消**；同篇只允許一項工作，切換筆記仍寫回原筆記。等待期間若有變更，顯示完整結果供複製、取消或明確取代。已開筆記透過編輯器更新，沿用 undo／Obsidian 自動儲存；已關筆記以原子內容比對寫入。

全文只支援公開 HTTP(S) HTML，不使用登入 Cookie、不執行網頁 JavaScript、不繞過付費牆。擷取逾時 30 秒、CLI 120 秒；5 MiB 限制作用於下載後解析，取消會丟棄晚到網路結果。Obsidian request API 不提供最終轉址 URL，轉址頁面相對連結仍以請求網址解析。

摘要會把選定文字傳給本機 CLI，CLI 可依設定連到雲端模型。插件在 vault 外建立並清除暫存工作目錄，直接啟動程式而不執行 shell；暫存目錄不等於作業系統沙箱。CLI 與其全域擴充／MCP 仍需可信，使用者自訂參數可改變工具限制。

## 規格與驗證

- [SPEC](SPEC.md)：需求與 S7 驗收條件。
- [實作計畫](docs/history/2026-09-22-rss-reader-mvp/implementation-plan.md)：T1–T6 分工與 ownership。
- [MVP validation](docs/history/2026-09-22-rss-reader-mvp/mvp-validation.md)：測試、規模量測、Obsidian smoke 與限制。

最低版本宣告為 Obsidian 1.8.7；實際驗證版本另見驗收記錄，不代表所有桌面版本均已測試。

## 側欄與 Obsidian themes

側欄參考 Feedly 的直列導覽：常用篩選、來源操作、Feeds 與 Unfiled 分區；資料夾箭頭可收合，名稱可選取範圍。右側數字為快取文章的未讀數，共用來源在 All articles 只計算一次。收合狀態保留至 view 關閉。

介面沿用 Obsidian 原生按鈕、圖示、導航色彩與字型變數；全文套用 `markdown-rendered` 與閱讀字型。來源 HTML 的 inline style、class 與舊式字色／字型屬性會移除，避免覆蓋主題。已實測 Default theme 明暗切換，並還原跟隨系統設定；第三方 themes 尚未逐一驗證。側欄未讀統計的新路徑尚未在原生 100k 資料下量測。

## 管理大量訂閱

**Manage sources** 會在主區域開啟獨立分頁，重複點擊復用同一頁。來源列表每頁 50 筆，可依名稱、URL 或資料夾搜尋全部訂閱；搜尋欄不會因輸入而重建。**Sources** 與 **Folders** 分開切換，編輯來源、分類及匯入匯出也在管理分頁內進行。解除資料夾關聯可在 **Edit / folders** 取消勾選。

## 保存筆記模板

Settings → Vault Feed Reader → **Saved note templates** 可設定：

- **Filename template**：不含 `.md`，預設 `{{date}} {{title}}`；移除不合法檔名字元，重名時自動加識別碼。
- **Body template**：Markdown 內文，預設為標題與文章內容；可加入心得、摘要整理或待辦區域。
- **Custom Properties**：不含 `---` 的 YAML mapping，支援文字、數字、布林、null 及上述值的列表。含變數的值請加引號，資料代入後由 serializer 處理 YAML escaping。

例如 Properties：

```yaml
tags:
  - rss
status: inbox
source: "{{feed}}"
```

例如內文：

```markdown
# {{title}}

## 我的筆記

## 文章內容

{{content}}
```

支援 `{{title}}`、`{{feed}}`、`{{link}}`、`{{published}}`、`{{created}}`、`{{date}}`；`{{content}}` 僅供內文，內容仍為 RSS 提供的正文／摘要。作者、獨立摘要與資料夾變數尚未支援。普通文字在內文會進行 Markdown escaping，正文則保留 HTML 清理後轉出的 Markdown；變數不會遞迴展開或執行程式。

`published`、`created` 預設為 ISO 時間，日期格式可用 `YYYY-MM-DD`、`YYYY-MM-DD HH:mm`、`YYYY-MM-DD HH:mm:ss`、`YYYY-MM-DDTHH:mm:ss`，例如 `{{created:YYYY-MM-DD}}`，均使用 UTC。缺少發佈時間時 `published` 為空；`date` 則依發佈時間、首次抓取、保存時間順序選擇日期。

設定頁即時預覽範例文章的檔名與 Markdown 原始碼；未知變數、錯誤 YAML 或保留欄位會顯示錯誤並停用 Apply。按 **Apply templates** 才保存設定；**Load defaults** 只重設草稿，仍須 Apply。`title`、`date_created`、`date_updated` 與 `feed_reader_*` 由系統維護，不能由自訂 Properties 覆蓋。

模板只影響新建筆記。已保存的文章仍開啟原筆記，不重新套版、不覆寫心得；修改模板也不會批次改寫歷史筆記。原有使用者未設定模板時沿用預設格式。


## OPML 訂閱搬移

在 **Manage sources → Import / export** 將 Format 選為 **OPML**，貼上內容或選擇 `.opml`／`.xml` 檔案，再按 Import。選檔不會自動切换格式，請先確認 Format。匯入預設 Merge；Replace all subscriptions 仍須確認。Generate export 可複製 OPML 文字，Download 下載 `feeds.opml`。

- 匯入接受 OPML 1.0、1.1、2.0；匯出為 OPML 2.0。YAML 仍是唯一訂閱權威來源。
- 巢狀分類攤平成 `父分類 / 子分類`，父分類與空分類保留；匯出為單層分類，不重建原階層。
- 重複 URL 合併並保留全部分類。匯出時同來源可出現在多個分類，再匯入仍是一個來源。
- 合併以完全相同的分類名稱對應既有分類，保留既有來源名稱、ID 與分類關聯；取代使用匯入名稱／分類，但已知 URL 仍沿用原 ID。
- OPML 不包含本專案 ID；搬到全新環境會產生 ID。閱讀狀態、正文快取與保存筆記不包含在 OPML。
- 優先使用 outline 的 title，再用 text；文章來源沒有名稱時用 URL。Feed URL 必須是 HTTP(S)。
- 格式錯誤、RSS outline 缺少 xmlUrl、未支援的 outline 類型、無名稱分類或攤平名稱歧義會使整次匯入失敗，不部分套用。DTD／自訂 entity 宣告不接受，標準 XML 字元 escaping 可用。
- 同名資料夾無法在標準 OPML 交換時區分；匯出或對應既有分類遇到同名歧義時，請先重新命名。

## 隱私與網路使用

- 更新時直接連線至使用者訂閱的公開 RSS／Atom URL（以及重新導向的目的地）取得文章，不需要 Feedly 或其他服務帳號。
- 顯示文章圖片時可能連線到 feed 指定的圖片主機，包括第三方網站。保存筆記保留遠端圖片 URL，於 Obsidian 閱讀時也可能載入；主機會收到一般網路請求，包括 IP 位址。
- 開啟原文時以外部瀏覽器開啟文章 URL。
- 插件沒有分析追蹤、遙測、廣告、付費功能或開發者營運的後端，也不會將筆記或閱讀狀態上傳到插件服務。
- 訂閱、閱讀狀態與保存筆記留在 vault；設定使用 Obsidian 插件資料儲存，文章快取使用本機 IndexedDB。插件不直接讀寫 vault 外的任意檔案；匯入檔案由使用者選取，匯出下載透過瀏覽器下載機制處理。

## 發佈與問題回報

發佈前請依照[發佈檢查清單](docs/releasing.md)確認資料、產物與驗證。請透過 [GitHub Issues](https://github.com/kywk/obsidian-feed-reader/issues) 回報問題，附上 Obsidian／插件版本、作業系統、重現步驟及相關錯誤。解析與匯入問題請提供最小公開 feed URL 或去識別化範例；分享前移除私人筆記、憑證及包含 token 的訂閱 URL。

## 授權

本專案採用 [MIT 授權](LICENSE)，著作權為 2026 kywk。第三方套件保留各自授權，詳見[第三方授權聲明](THIRD_PARTY_NOTICES.md)。建置會將授權聲明嵌入 `main.js`，隨安裝檔一起散布。

## 新增來源對話框與筆記日期

**Manage sources → Add source** 會開啟彈出對話框，保留底下來源清單。標題可空白：僅輸入 RSS／Atom URL 後按 Add，會嘗試讀取 feed 標題；失敗或無標題時保留草稿，讓你填入標題再送出。手填標題優先，不會被自動結果覆蓋。既有來源編輯仍在管理頁。

新保存筆記使用 `date_created`、`date_updated`（UTC ISO 時間），初次皆為保存時間。全文／摘要更新保留建立時間並更新 `date_updated`，不再輸出 `feed_reader_saved_at` 與 `feed_reader_first_fetched_at`。舊筆記仍能去重／開啟，明確執行全文或摘要更新時才轉換日期欄位；不整批改寫歷史筆記，也不監聽人工編輯修改時間。重複 Save 仍只開啟筆記。

AI 摘要命令也會在同一次請求產生 3–5 個主題標籤，合併進 frontmatter 的 `tags` YAML 清單；保留原有標籤並忽略大小寫去重。沒有 Properties 時新增 frontmatter。摘要與 tags 一起寫入，AI 格式無效時整次不寫入。單獨擷取全文不產生標籤。自訂提示詞仍控制摘要內容，回傳格式由插件要求為含 `summary`／`tags` 的 JSON。
