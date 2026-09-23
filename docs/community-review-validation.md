# 社群審查修正與驗證

日期：2026-09-22。來源：[官方掃描結果](https://community.obsidian.md/account/plugins/vault-feed-reader)。

## 0.1.0 掃描結果

官方對 f021602 的檢查：Failed。依賴檢查無已知漏洞；建置可逐位元重現 Release main.js，兩項皆通過。

阻擋錯誤與 0.1.1 修正：

| 項目 | 修正 |
|---|---|
| onunload 移除 leaves，導致使用者版面配置遺失 | 移除 detachLeavesOfType，由 Obsidian 管理已註冊 view；保留既有服務與排程清理 |
| 設定頁直接建立 HTML 標題 | 使用 Setting.setName().setHeading() |
| innerHTML 寫入 | DOMPurify 直接回傳 DocumentFragment 供 UI append；字串輸出與 fragment 共用清理設定及 URL hook |
| 直接指定固定樣式 | 訂閱匯入 textarea 寬度改用 CSS class |

新版本 Release 僅附 main.js、manifest.json、styles.css，依官方建議不再額外上傳非安裝附件。MIT 與第三方授權仍完整內嵌於 main.js，儲存庫亦保留原文。

## 本機驗證（0.1.1 完整工作區）

- PASS：`npm run build`（含 TypeScript）。
- PASS：`npm test`，16 test files、91 passed、1 opt-in scale skipped。
- PASS：新增清理回歸測試，確認 fragment 與保存 HTML 相同、移除執行碼／主題覆寫，拒絕 javascript、file、data URL 並正確解析相對 URL。
- PASS：`git diff --check`；src 無 innerHTML 寫入、detachLeavesOfType 或直接 style 屬性指定。
- NOT_RUN：原生 Obsidian 停用／重載分頁位置、設定頁外觀、最低版本 1.8.7、真實 OPML 互通及規模量測。既有 mock 與歷史實機結果不替代這些驗證。
- PENDING：0.1.1 官方重新掃描；本機測試不代表已通過上架審查。

## 未納入此次修正

0.1.0 的非阻擋項目：artifact attestations、vault 檔案枚舉、popout window／timer API、型別與 assertion 警告、控制字元正規表示式、較新版 declarative settings API、XML API 棄用、setWarning 棄用及未使用符號。未宣稱這些均已修復；版本相容性與後續整理需另行驗證。

## 0.1.1 審查與 0.1.2 修正

使用者收到 0.1.1 審查失敗通知。2026-09-22 讀取結果時，頁面仍顯示 Pending／部分檢查進行中，但已列出新的阻擋錯誤：`Avoid including the plugin name in settings headings.`（src/settings.ts:16）。前次四類錯誤已不再列出，依賴檢查通過。

0.1.2 移除設定頁頂端重複的外掛名稱標題，保留功能區段標題與設定操作。其餘非阻擋警告維持上述記錄。

本機驗證：`npm run build` PASS；`npm test` PASS（91 passed、1 opt-in scale skipped）；`git diff --check` PASS。未執行原生 Obsidian 外觀與最低版本驗證。官方重新掃描結果仍待確認。

手動驗證重點：開啟設定頁，確認頂端不再重複顯示 Vault Feed Reader；Subscriptions YAML、保存資料夾、Saved note templates 與 Preview 區段仍正常，修改模板與 Apply 操作不受影響。

## 0.4.0 審查警告修正

來源：2026-09-23 讀取的 [外掛頁面](https://community.obsidian.md/plugins/vault-feed-reader) Scorecard。最新 release（e26506f）自動掃描列出 59 項，其中 46 項為 Warnings、13 項為 Other；評等 Review: Caution。

修正對照（依官方回報規則）：

| 規則／訊息 | 修正 |
|---|---|
| `prefer-window-timers`（setTimeout／clearTimeout／setInterval／clearInterval） | 改用 `window.*`，timer 型別改 `number`，符合 popout window 相容性 |
| `no-global-this` | `globalThis.indexedDB` 改 `window.indexedDB`；`globalThis.crypto` 改全域 `crypto` |
| `prefer-create-el` | Notice fragment 改用 `createFragment()`／`createSpan()`／`createEl()` |
| `no-unsafe-assignment`／`member access`／`argument` | 為 `loadData`、`loadLocalStorage`、XML parse 結果與 spawn data callback 補型別或 assertion |
| `no-unnecessary-type-assertion` | 移除 read-state、saved-note frontmatter、TOML 序列化多餘 assertion |
| `no-misused-promises` | `forEach` callback 改 block body |
| `no-useless-escape`／`no-control-regex` | 移除字元集合多餘 escape；控制字元改用 `\p{Cc}` Unicode 屬性 |
| `no-base-to-string`／`restrict-template-expressions` | OPML outline type 先收斂為 string 再使用 |
| `no-deprecated`（`XMLValidator`／`XMLBuilder`） | 改用官方替代套件 `fast-xml-validator` 的 `SyntaxValidator` 與 `fast-xml-builder` 的 `Builder` |
| `no-deprecated`（`display`） | 設定頁抽成 `render()`，`apply` 不再直接呼叫 deprecated `display()` |
| `no-deprecated`（`setWarning`） | 以相容呼叫保留 1.8.7 支援，優先 `setDestructive`，否則 `setWarning`（見下方未修正項） |
| `no-unused-vars` | 移除未使用的 `SubscriptionSnapshot` import 與 `scopeTitle` |

新增 runtime 依賴 `fast-xml-validator`、`fast-xml-builder`（後者原為 fast-xml-parser 的 transitive 依賴），同步更新 THIRD_PARTY_NOTICES.md 及內嵌於 main.js 的授權文字。

本機重現與驗證（2026-09-23，Node 26.8.2）：

- 以 `eslint-plugin-obsidianmd` 0.4.2 的 `recommended` 設定掃描 `src`：修正前 57 problems（25 errors、32 warnings），修正後 1 warning（`settings-tab/prefer-setting-definitions`）。
- PASS：`npm run build`（含 TypeScript）。
- PASS：`npm test`，28 test files、194 passed、1 skipped；`tests/cache/indexeddb-cache.test.ts` 的 500 筆保留測試在完整套件平行負載下逾時 5s，於未修改的 main 基準同樣失敗，屬既有環境問題，單獨執行該檔通過。
- PASS：`git diff --check`。
- NOT_RUN：原生 Obsidian 外觀、popout window 實機、最低版本 1.8.7、真實 OPML 互通與規模量測。mock／jsdom 結果不替代實機。

未修正或保留項：

- `settings-tab/prefer-setting-definitions`：宣告式 settings API 需要 Obsidian 1.13.0，與 manifest 目前 `minAppVersion` 1.8.7 衝突；全面改用需先決定是否放棄舊版支援，故未納入本次。
- `medium: Direct Filesystem Access`／`Shell Execution`：本機 Agent 摘要功能需 `node:child_process`、`node:fs/promises`、`node:os`、`node:path` 執行使用者選擇的 CLI，屬功能本質揭露，非可移除的程式缺陷。
- `Missing GitHub artifact attestations`：發布流程層級，需另於 GitHub Actions 產生 provenance，非本次程式修正範圍。
- `Obfuscation scan not available`、`Number of network request calls`、`Vault Enumeration`、`Clipboard Access`：資訊性揭露，非缺陷。

上述本機 eslint 結果使用外掛推薦設定重現，非官方掃描器逐項等價；最終計數以官方重新掃描為準。
