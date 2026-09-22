# Multi-agent 工作分工

依本次使用者要求進行分工；共享 checkout，禁止跨 ownership 修改。

| 工作 | Owner | 檔案 | 驗收 |
|---|---|---|---|
| 筆記範圍與安全更新 | note_core | src/enrichment/note.ts、tests/enrichment/note.test.ts | 多規則、標記、fence、Properties、摘要排除 |
| 公開正文擷取 | inspect_article_hooks | src/enrichment/fetch.ts、tests/enrichment/fetch.test.ts | HTTP/錯誤/空內容/清理/取消 |
| 本地 Agent | agent_cli | src/enrichment/agents.ts、tests/enrichment/agents.test.ts | 四工具與自訂、spawn、取消、timeout、output |
| 整合與文件 | root | 其餘新整合檔、main/settings、依賴與文件 | 命令、設定、競爭保護、整體驗證 |

依賴：核心 API 先通知 root；root 安裝 Readability 並維護 lockfile。子 agent 不提交；root 整合與查核每項結果。所有實作狀態與驗證以 validation.md 最終記錄為準。

後續明確擴充 ownership：note_core 完成 service.test.ts 與筆記同名標題回歸；inspect_article_hooks 完成 controller.test.ts 與既有設定 DOM 測試擴充；agent_cli 完成 agents-process.test.ts 真子程序驗證。各組均已交付，root 整合修正 editor buffer 與卸載生命週期問題。沒有新增其他 task 或 worktree。
