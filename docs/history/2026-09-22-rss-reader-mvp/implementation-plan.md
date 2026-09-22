# MVP implementation plan

## 現況與交付順序

起始狀態：T0 骨架已建立：TypeScript/esbuild、manifest、空 view、設定頁、資料型別。當時 RSS 功能尚未完成。優先交付垂直流程「新增來源→取得文章→閱讀→保存」，再補齊交換格式與分類管理；仍需滿足 SPEC 才算完整 MVP。

1. 使用者一次確認執行工具及下表模型分配。PM 隨後可自行處理一般實作選擇，無需追加契約審核回合。
2. 第一波：T1（訂閱＋已讀）與 T2（抓取＋本機快取）並行。兩者只共用已存在的資料型別；PM 管理必要型別調整。
3. 第二波：T1/T2 通過後，T3（reader UI）與 T4（Markdown 保存）並行。T3 先接現有 services，Save handler 由 PM 在整合階段接上。
4. T5 接線、訂閱管理介面、scheduler、設定、匯入匯出入口，跑出可使用 MVP。不要等待所有 UI polish 才試讀一個來源。
5. T6 執行針對性驗證、實機 smoke 與規模檢查，修正 blocking defects，更新 README 的實際完成狀態。

## 任務與建議模型

等級：L1 明確且局部；L2 中等、邊界可控；L3 多狀態／資料正確性；L4 跨模組整合與難重現問題。下列配對是工程判斷，不是官方基準測試或價格承諾。名稱以本次 Codex 環境已提供的選項為準；使用者可指定其他工具／模型。

| Task | 工作 | 等級 | 建議模型／reasoning | 依賴 | 狀態 |
|---|---|---|---|---|---|
| T0 | 骨架與本任務包 | L1 | 已由本次主 agent 完成 | — | 完成，驗證見 validation.md |
| [T1](tasks/T1-vault-data.md) | 訂閱、交換格式、已讀 JSON | L3 | gpt-5.6-sol / high | T0 | 完成，build／35 tests 通過 |
| [T2](tasks/T2-feeds-cache.md) | RSS/Atom、穩定 ID、本機快取 | L3 | gpt-5.6-sol / high | T0 | 完成，build／35 tests 通過 |
| [T3](tasks/T3-reader-ui.md) | 列表、內容、篩選、快捷鍵 | L2 | gpt-5.6-terra / high | T1、T2 | 完成，build／52 tests 通過 |
| [T4](tasks/T4-save-markdown.md) | Markdown 保存、筆記索引 | L3 | gpt-5.6-sol / high | T1、T2 | 完成，build／52 tests 通過 |
| [T5](tasks/T5-integration.md) | 接線、管理 UI、更新生命週期 | L4 | gpt-6-astra / high | T1–T4 | 完成，核心流程已實機驗證 |
| [T6](tasks/T6-acceptance.md) | 回歸、規模與實機驗收 | L3 | gpt-5.6-sol / high | T5 | 完成，測試與實機結果見 mvp-validation.md |
| PM | 調度、少量共用檔案修改 | L3 | 保留目前主 agent（使用者已確認） | 工具／模型確認 | 完成，README 與驗收限制已更新 |

模型角色参考 [OpenAI Models](https://learn.chatgpt.com/docs/models)，2026-09-22 查閱；本表具體任務配對為本專案建議。L1 的後續純文件修訂可選 gpt-5.6-luna / medium，無需另外拆成 agent 任務。T5 若由 PM 親自做，可直接用經確認的 PM 模型，不為模型切換增加流程。

## Ownership 與共享檔案

| Task | 寫入範圍 |
|---|---|
| T1 | `src/subscriptions/**`、`src/read-state/**`、`tests/subscriptions/**`、`tests/read-state/**` |
| T2 | `src/feeds/**`、`src/cache/**`、`tests/feeds/**`、`tests/cache/**`、`tests/fixtures/feeds/**` |
| T3 | `src/ui/views.ts`、`src/ui/reader/**`、`src/ui/content.ts`、`styles.css`、`tests/ui/**` |
| T4 | `src/save/**`、`tests/save/**` |
| T5/PM | `src/main.ts`、`src/settings.ts`、`src/ui/manage/**`、`src/scheduler.ts`、整合測試 |
| T6 | `tests/acceptance/**`、驗收記錄；產品修正由 PM 分配檔案 ownership 後執行 |

PM 擁有 `package.json`、lockfile、`src/domain/models.ts` 與 SPEC。worker 若需依賴，傳套件名稱與用途給 PM，由 PM 一次安裝並通知，避免多人改 lockfile。預期 T1 用 YAML/TOML serializer、T2 用 XML parser/IndexedDB 測試工具、T3 用 sanitizer、T4 用 HTML-to-Markdown converter；按需要採用成熟小型工具，不預裝未使用依賴。

T1 發布來源身分 helper 供重新訂閱復用；T2 只消費 feedId，不另造来源 ID。T3 發布單一 sanitize/URL policy helper，T4 需要同規則時由 PM 接線，避免多套安全政策。共享 API 以實際 TypeScript exports 為準，worker 收尾回報 exports 與呼叫範例即可，不先寫 interface 契約文件。

## 最小上下文派工

每個 `tasks/T*.md` 都可直接作 worker 初始 prompt，含工作目錄、必要需求、檔案範圍、起手式與完成條件。PM 派工時附上：核准工具／模型、前置任務產物路徑、實際 exports／必要變更。worker 讀自己 task、models、指定 SPEC 章節與直接 import 的實作；不讀全部 history、不重新遍歷整個 repository。

同時最多兩個功能 workers 即可；共享 workspace 依 ownership 寫入。若所選工具適合 worktree，PM 可改用隔離 checkout，但先有可用 Git baseline 才建立，這次骨架尚未 init/commit。每波結束 PM 整合並跑 build/test，再派下一波。若 tool 不提供 subagents，仍可把相同 prompt 分派到使用者選定工具，不自動替使用者改模型。

## 完成標準與回報

功能 worker 應交付可執行實作及重要失敗路徑測試，不交只有接口的 stub。回報限：修改檔案、exports/接線示例、執行命令及結果、尚未完成事項。PM 收斂至一份 SPEC，不新增 ADR、重複 summary 或契約確認文件。MVP 完成以 SPEC S7 為準；測試與 build 通過後仍需 Obsidian 實機 smoke。
