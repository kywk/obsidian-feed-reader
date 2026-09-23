# 專案進展與提交脈絡

更新日期：2026-09-22。此檔補充早期簡短 commit 的需求、成果與驗證，不改寫 Git 歷史。後續提交遵循 [Commit 規範](agents/commits.md)。

## 筆記全文與本地 Agent 摘要 — feature branch

分支 `codex/article-fulltext-ai-summary`，本次工作已按保存、訂閱 UI、文章增補與文件分批提交，已合併 main 並發布 GitHub 0.2.0，Obsidian 新版審查 Pending。新增僅作用目前 Markdown 筆記的全文與摘要命令、多組原文辨識、本機 CLI 設定、取消與修改衝突保護。

文件入口：[規格](history/2026-09-22-article-enrichment/spec.md)、[分階段計畫](history/2026-09-22-article-enrichment/implementation-plan.md)、[multi-agent 分工](history/2026-09-22-article-enrichment/multi-agent-tasks.md)、[技術查證](history/2026-09-22-article-enrichment/research.md)、[本次驗證](history/2026-09-22-article-enrichment/validation.md)。不將 mock／程序測試當成真實 CLI 模型或 Obsidian 實機通過。

## c8f49de — MVP 基準與選型分析

建立本專案初始 Git 基準：RSS／Atom 訂閱、閱讀列表與正文、閱讀狀態、精選 Markdown 保存、來源管理與模板設定。訂閱以 YAML 為權威，文章內容使用本機 IndexedDB，保存筆記保留人工修改。

納入三款閱讀器比較，確認延續「大量瀏覽、精選保存」，優先補 OPML 搬移能力。這是整體初始快照，並非各功能各自完成時的逐筆歷史。

驗證依 [MVP validation](history/2026-09-22-rss-reader-mvp/mvp-validation.md)：最後一般測試紀錄為 72 passed；先前 2 個 scale tests 使用模擬環境；Obsidian 實機只涵蓋該文件列出的流程，模板設定更新未做實機操作。

## 4e52ee4 — OPML 核心與來源身分

新增 OPML 1.0／1.1／2.0 匯入及 2.0 匯出，沿用 YAML 持久化。巢狀分類攤平、重複來源保留全部歸屬；已知 URL 沿用來源 ID，使原閱讀狀態仍可對應。分類歧義與無效內容整次拒絕，避免部分套用。

測試涵蓋版本、特殊字元、空分類、多分類、往返、錯誤輸入，以及 merge／replace／服務重啟後 ID 保留。

## b460597 — OPML 管理介面

管理頁加入格式選擇、OPML 檔案接受範圍、文字匯出與下載。Replace 延續確認流程，匯出錯誤提供通知。操作測試確認格式傳遞與確認前不執行取代。

## 8b4c2ff — OPML 操作與驗收文件

更新 README、SPEC 與 [OPML 驗證記錄](opml-validation.md)，交代格式、分類攤平、ID、錯誤處理與未驗證項。

OPML 三筆提交的共同驗證在分批前的完整工作區執行：build 通過，16 test files、90 passed、1 opt-in scale skipped；不是每個中間 commit 的獨立測試。尚未做原生 Obsidian 選檔／下載、真實 Feedly 或其他插件匯出檔互通測試。

## 開發規範補齊

新增根目錄 [AGENTS.md](../AGENTS.md) 與按需載入的工作流程、資料模組、Obsidian UI、內容安全、commit 與驗證規範；參考 CMS 文件結構，保留本專案的資料契約與既有驗證方式。後續 commit 要交代成果、原因、驗證界線與實際模型貢獻。

## 0.1.1 社群審查修正

0.1.0 上架掃描拒絕後，修正四類阻擋錯誤：停用移除分頁、設定頁標題、HTML 寫入與固定樣式。顯示及保存共用 DOMPurify 清理規則；新增安全回歸驗證。詳見[審查修正與驗證](community-review-validation.md)。

## 0.2.0 發布

發布 commit 33e6626；[GitHub Release](https://github.com/kywk/obsidian-feed-reader/releases/tag/0.2.0) 已公開，三附件雜湊比對通過。官方已排入 0.2.0 自動掃描，狀態與限制见 [發布紀錄](history/2026-09-22-article-enrichment/release-0.2.0.md)。

## 0.3.0 多語系

新增英文、繁體中文與跟隨 Obsidian 的語言設定，涵蓋閱讀器、管理頁、設定及命令。語言於重新啟用插件後套用，保留未套用草稿與原始筆記資料。發布前完整工作區 build 通過，191 tests passed、1 scale skipped；範圍與實機未測項見 [多語系驗證](i18n-validation.md)。

多語系提交 9654834；發布提交 2bf755f。GitHub 0.3.0 已公開，三個安裝附件雜湊一致；官方已確認 0.3.0 排入掃描，尚未取得審查完成結果。詳見 [0.3.0 發布紀錄](release-0.3.0.md)。

## 0.4.0 閱讀介面與連結操作

精簡來源與文章工具列，新增原文網址／Markdown 連結複製、寬版固定導覽列標題與回到頁首按鈕。發布提交 e26506f；GitHub Release 已公開，obs-feedly 同步完成，官方確認 0.4.0 排入掃描。建置通過，195 tests passed、1 scale skipped；詳見 [發布與驗證紀錄](release-0.4.0.md)。

## 0.4.0 審查警告修正（未發布）

依官方 0.4.0 掃描的 46 項 Warnings 修正 timer popout 相容性、globalThis、createEl、unsafe any、多餘 assertion、escape／control regex 與 deprecated XML API；以 `eslint-plugin-obsidianmd` 重現後僅餘 1 項 `prefer-setting-definitions`（需 Obsidian 1.13 宣告式 API）。新增 `fast-xml-validator`、`fast-xml-builder` 依賴。驗證與未修正項見[審查修正與驗證](community-review-validation.md)。
