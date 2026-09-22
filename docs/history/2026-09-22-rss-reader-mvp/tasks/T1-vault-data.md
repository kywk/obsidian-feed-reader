# T1 — 訂閱與已讀資料（可直接作 worker prompt）

你負責 `/Users/kywk/Dropbox/project/obsidian/feedly` 的 Obsidian 桌面 RSS reader 資料層。工具／模型由 PM 帶入；不要自行派下層 agents。先讀 `src/domain/models.ts`、`SPEC.md` 的 S2/S3 及 `src/settings.ts` 預設值，其他 history 不需載入。

寫入範圍：`src/subscriptions/**`、`src/read-state/**` 和對應 tests。共用 models、package/lockfile 由 PM 修改；需要套件先把名稱用途交 PM。

實作：vault YAML 作訂閱權威來源，單層資料夾多歸屬，未分類為零歸屬。提供 CRUD、解除分類、全域取消訂閱、YAML/TOML 合併與取代匯入及匯出。URL 去重但保留 query；來源 ID 在取消後重加仍相同（可用 URL 穩定 digest），提供 helper。外部修改事件重新載入，無效內容沿用 last-good 並禁止 UI 回寫。序列化寫入，處理自己寫入觸發的事件，失敗不靜默覆寫。取代確認由 UI 做，service 接明確 mode。

已讀按來源 versioned JSON 放 `Feed Reader/state/`，與 cache 無耦合；截止、個別已讀、未讀例外，優先例外。時間採 publishedAt 或 firstFetchedAt；全已讀截止 now、處理等號邊界，清掉涵蓋例外。只有明確批次動作推進截止。重新訂閱、淘汰 cache 不丟狀態；讀寫失敗回傳可顯示錯誤。未知舊 ID 可保留，避免過度壓縮演算法。

開始就寫功能及測試；用小型 storage adapter 注入方便測 IO 失敗，不建通用 repository framework。輸出可被 UI/PM 使用的訂閱服務、read-state 服務及變更通知。記錄實際 exports 與最短呼叫例即可，不產額外契約文件。

完成條件：測格式往返、多分類 URL 合併、外部破損、併發 UI 寫入、重加來源 ID、cutoff/例外/等號/重啟/寫入失敗。`npm run build` 及相關 tests 通過。回報改檔、exports、驗證與限制。整合 UI 留 T5。
