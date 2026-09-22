# Commit 規範

草擬訊息、stage 或 commit 前讀本文件。格式不授予 commit 權限；依會話中已取得的授權執行。提交本次已確認路徑，不自動 push。

## 分批與檢查

1. 查看 status、diff 與近期 log，辨識既有成果與本次改動。
2. 依可獨立審查的成果拆分，例如訂閱核心與測試、管理介面與操作測試、規格與驗收文件。每批包含必要依賴，避免只按副檔名拆批。
3. Stage 明確路徑後查看 staged diff 與 whitespace 檢查，確認無無關改動。依 validation.md 記錄實際驗證範圍。
4. 提交後查看完整訊息與工作區狀態；交付列出 hash、成果與未提交項目。

main.js、node_modules 等忽略項以 .gitignore 為準，不強制加入。初始 MVP 已作為整體基準提交，後續增量依成果拆分。

## 訊息格式

採 Conventional Commits。Subject 使用英文祈使句，原則上不超過 72 字元、不加句點。type 可用 feat、fix、refactor、test、docs、build、ci、perf、chore、revert；scope 依實際模組，例如 subscriptions、reader、cache、save、ui、agents。

功能、修正與多項成果的 commit 必須有 body，說明觸發需求、具體行為與值得保留的取捨；簡單拼字修正可省略。本文使用英文或繁體中文，單一 commit 保持一致。

```text
feat(subscriptions): add OPML exchange with stable source identities

- Import nested categories as flat paths and retain all feed memberships.
- Reuse known URL identities so existing reading state remains associated.

Tests: npm run build; npm test — <actual result and scope>
Not tested: <material validation still missing>

Co-Authored-By: <actual contributing model>
```

- Tests、Not tested、Blocked 只列有值項目；文件修改可用 Validation 描述連結、內容與 diff 檢查。
- 若驗證是在拆批前的完整工作區執行，明寫 combined working tree，不宣稱每筆中間 commit 都單獨測過。沿用舊結果時標出來源與日期。
- 未達到本次約定完成條件的 checkpoint 標 `Status: WIP`，並列待完成項；剩餘非必要驗證可列 Not tested，不把它寫成通過。
- 破壞式變更使用 `!` 與 `BREAKING CHANGE:`，說明影響及遷移。
- 最後一段放單行 `Co-Authored-By:`，列實際貢獻模型名稱、以逗號分隔去重。名稱以實際執行資訊為準，不推測檔位；完全未知才用 `Unknown model` 並在交付說明。不虛構 email；Git 的人類 author/committer 維持既有設定。此純名稱 trailer 不保證被 hosting 平台識別為共同作者帳號。
- 多行訊息寫入檔案，使用 `git commit -F <file>`，保留真實換行。

## 歷史補充

本規範適用後續提交。既有簡短 commit 的原因、結果與驗證可補在 docs/progress.md；只有使用者明確要求改寫歷史時才 reword／rebase／amend。歷史說明不冒稱當時執行了未記錄的測試。

來源：參考 `/Users/kywk/nanshan/cms/AGENTS.md`、`docs/agents/commits.md` 與實際 commit body，於 2026-09-22 調整為本專案規範。執行時不依賴外部 CMS 目錄。
