# Vault Feed Reader

[English](README.md)

專為 Obsidian 設計的桌面版 RSS / Atom 閱讀器，主打大量瀏覽、精選保存為 Markdown 筆記。

---

## 1. 專案用途

Vault Feed Reader 將流暢高效的現代 RSS 閱讀體驗整合進 Obsidian，無需依賴任何第三方聚合服務（不需 Feedly 或其他雲端帳號）。

本插件秉持 **「Vault 為唯一權威來源」** 的架構理念：
- **訂閱清單**、**閱讀狀態**、**個人清單**（我的最愛與稍候閱讀）以及**保存筆記**全數存放於 Vault 中（`.yaml`、`.json`、`.md`），隨 Vault 打包即可無縫轉移至其他電腦或同步。
- **文章快取**儲存於本機 IndexedDB 資料庫，提供快速瀏覽與離線閱讀，且可隨時淘汰重建，不汙染 Vault 同步空間。

---

## 2. 使用情境

- **每日資訊大量篩選**：透過全鍵盤快速操作（`j` / `k`），快速掌握今日更新（Today）或未讀文章（Unread）。
- **稍候閱讀與精選最愛**：即時分流資訊——將長文或待查文章加入**稍候閱讀（Read Later）**，或為重要文章標記**我的最愛（Favorite）**，不需立即建立筆記。
- **精選文章轉為筆記**：按鍵即可將 RSS 正文保存為結構化的 Markdown 筆記；再次保存會直接開啟既有筆記，確保人工編輯不被覆寫。
- **筆記全文擷取與 AI 摘要**：針對保存的文章或 Web Clipper 剪藏筆記，使用本機 AI Agent（Claude Code、Codex、OpenCode、pi）一鍵抓取公開原文並生成重點摘要與主題標籤。

---

## 3. 功能特點

- **直覺流暢的閱讀介面**：
  - **左側導覽列**：快速切換 `Today`（今日）、`Saved`（已保存）、`Favorite`（我的最愛）、`Read Later`（稍候閱讀），下方提供單層資料夾分類樹與未讀文章數量徽章。
  - **列表上方雙組導覽按鈕**：以分隔線 `|` 清楚區隔狀態與範圍：
    `All articles`（全部） / `Unread`（未讀） / `Read`（已讀） | `Today`（今日） / `Saved`（已保存） / `Favorite`（我的最愛） / `Read Later`（稍候閱讀）
  - **雜誌卡片版面**：單一 Feed 支援縮圖、作者與摘要的卡片式雜誌檢視；資料夾與全域則提供緊湊清單。
  - **純圖示工具列**：
    1. 開啟原文網址（`external-link`）
    2. 複製原文網址（`link`）
    3. 複製 Markdown 連結（`file-text`）
    4. 保存／開啟筆記（`bookmark`，已保存顯示 `bookmark-check` 與高亮）
    5. 加入／移除我的最愛（`star`，已加入時高亮）
    6. 加入／移除稍候閱讀（`clock`，手動點擊移除，已加入時高亮）
    7. 切換已讀／未讀（`check-check`）
  - **全鍵盤快捷鍵**：
    | 快捷鍵 | 動作 |
    |---|---|
    | `j` / `k` | 下一篇／上一篇（文章開啟時同步切換） |
    | `Enter` | 開啟選取文章 |
    | `o` | 在外部瀏覽器開啟原文 |
    | `m` | 切換已讀／未讀 |
    | `s` | 保存為筆記或開啟已保存筆記 |
    | `Esc` | 返回文章列表 |
- **Vault 核心儲存**：
  - 訂閱儲存於 `feeds.yaml`，支援 OPML / YAML / TOML 完整匯入與匯出。
  - 閱讀狀態與使用者清單存於 `${rootFolder}/state/` JSON 檔案。
  - 每來源保留最新 500 篇本機快取；快取淘汰不影響閱讀紀錄與筆記。
- **自訂筆記模板與編輯保護**：
  - 自由定義檔名、Properties YAML 及內文模板（支援 `{{title}}`、`{{feed}}`、`{{link}}`、`{{date}}`、`{{content}}` 變數）。
  - 保存後的人工筆記內容絕對安全，重複保存不覆寫既有修改。
- **本機 AI 摘要與全文增強**：
  - 於 Markdown 筆記中執行命令：抓取原文全文、產生 AI 摘要與主題 tags、或一鍵全文＋摘要。
  - 支援本機 CLI 工具，兼顧隱私與自訂 Prompt。
- **完整多語系支援**：
  - 內建英文與繁體中文（zh-TW），啟動時自動偵測 Obsidian 語系。

---

## 4. 配置設定方式

於 **設定 → Vault Feed Reader** 進行配置：

### 一般設定
- **Feed Reader 根目錄**：Vault 相對路徑（預設 `Feed Reader`）。切換至空目錄時會提示搬移原檔案或建立新來源。
- **訂閱 YAML**：訂閱設定檔路徑（預設 `Feed Reader/feeds.yaml`）。
- **文章保存資料夾**：保存 Markdown 筆記的目錄（預設 `Feed Reader/Articles`）。
- **預設列表篩選**：開啟文章清單時的初始檢視（`unread` 未讀、`all` 全部、`read` 已讀、`today` 今日）。
- **使用 j/k 切換時標為已讀**：是否在鍵盤移動焦點時自動標記已讀（預設關閉）。
- **語言**：選擇 `跟隨 Obsidian`（預設）、`English` 或 `繁體中文`（重啟插件生效）。

### 保存筆記模板
- **檔名模板**：例如 `{{date}} {{title}}`（不需輸入 `.md`）。
- **正文模板**：Markdown 內文排版，可嵌入 `{{content}}`。
- **自訂 Properties**：YAML 對應表（不需 `---`），支援標籤與各類自訂欄位。

### 筆記全文與 AI 摘要
- **原文網址欄位**：設定 Properties 中存放網址的鍵值（預設 `feed_reader_url, source, url`）。
- **原文標題與規則**：定義全文抓取後附加或取代的標題區塊。
- **摘要提示詞**：自訂 AI 摘要的重點結構與標籤生成要求。
- **本機 Agent**：選擇內建 CLI（`codex`、`claude`、`opencode`、`pi`）或自訂 CLI 執行檔路徑與參數，並可進行即時測試。

---

## 5. 其他 Obsidian 官方規定資訊

- **平台相容性**：僅支援 Obsidian 桌面版（macOS, Windows, Linux）。宣告最低需求版本：**1.8.7**。
- **安裝方式**：
  - **社群外掛市場**：於 Obsidian 設定中的「社群外掛」搜尋 `Vault Feed Reader` 點選安裝並啟用。
  - **手動安裝**：從 [GitHub Releases](https://github.com/kywk/obsidian-feed-reader/releases) 下載最新 `main.js`、`manifest.json`、`styles.css`，放置於 Vault 的 `.obsidian/plugins/vault-feed-reader/` 目錄並啟用。
- **網路與隱私聲明**：
  - 僅透過 HTTP(S) 直接向您訂閱的公開 RSS / Atom 來源發送請求以抓取文章。
  - 內文圖片依來源設定由第三方圖片伺服器載入。
  - 無任何分析追蹤碼、遙測、廣告、使用者帳號或開發者中繼伺服器。
  - AI 摘要皆透過您本機安裝的 CLI 工具執行，插件本身不轉發任何筆記內容。
- **授權條款**：[MIT License](LICENSE)。
