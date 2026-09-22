# Vault Feed Reader

使用繁體中文與台灣常用詞彙回覆。這是 Obsidian 桌面 RSS／Atom 插件，產品方向為大量瀏覽、精選保存；使用者操作與現況見 README.md，行為契約見 SPEC.md。

## 開發邊界

- 訂閱以 vault YAML 為唯一權威來源；交換格式透過訂閱服務匯入，不另建持久化來源。
- 來源 URL 與穩定 ID 連結閱讀狀態。修改匯入、取消訂閱或重新訂閱時，確認 ID 保留與多資料夾歸屬。
- 閱讀狀態與保存筆記留在 vault；IndexedDB 是可淘汰的本機快取，不是歷史封存或跨裝置同步來源。
- 保存與閱讀沿用共用內容清理規則；既有筆記保留人工編輯。變更這些契約時同步更新 SPEC.md。
- 核心邏輯與儲存介面沿用現有模組界線；Obsidian 整合放在 adapter、UI 或入口。精確版本與命令以 package.json 為準。
- 功能完成需有相應驗證證據；先前 mock／實機結果只適用記錄中的範圍。外部 vault 的安裝與真實訂閱操作依使用者授權範圍執行。

## 依需載入

| 觸發情境 | 必讀文件 |
|---|---|
| 跨模組任務、協作、依賴或文件整理 | [工作流程](docs/agents/workflow.md) |
| 修改核心資料、儲存、更新或保存服務 | [資料與模組](docs/agents/data-and-modules.md) |
| 修改 UI、樣式、設定或生命週期 | [Obsidian UI](docs/agents/obsidian-ui.md) |
| 修改解析、內容顯示、模板或檔案路徑 | [內容安全](docs/agents/content-safety.md) |
| 草擬 commit、stage、提交或整理歷史 | [Commit 規範](docs/agents/commits.md) |
| 選擇驗證、執行檢查或報告完成 | [驗證規範](docs/agents/validation.md) |
| 修改閱讀、訂閱、儲存或保存行為 | [SPEC.md](SPEC.md)，再讀相應 src 模組 |
| 查本機安裝與操作 | [README.md](README.md) |
| 查已提交進展與證據 | [進展索引](docs/progress.md) |

現行規範為本檔及 docs/agents/；docs/history/ 是歷史證據，不代表當前功能、派工或工具授權。多 agent 與模型選擇依本次會話授權，不自動沿用其他專案設定。
