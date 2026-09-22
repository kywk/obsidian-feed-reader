# 側欄與主題視覺驗收 — 2026-09-22

final result: passed

## 參考與證據

- Source visual truth: `/Users/kywk/Desktop/Screenshot 2026-09-22 at 13.18.59.png`（355 × 809 px）。
- Implementation screenshots: `docs/history/2026-09-22-rss-reader-mvp/screenshots/sidebar-dark.png`、`sidebar-light.png`（984 × 768 px）。
- Native Obsidian 1.13.7 視窗；截圖座標 984 × 768，未透過瀏覽器量測 CSS viewport/devicePixelRatio，不聲稱像素級複製。
- 比較時共同檢視參考與明暗實機圖，聚焦左側約 290 px 內容區；不把 Obsidian 的 ribbon、分頁及視窗框當成設計差異。
- 狀態：All articles 選取、Technology 收合、Reading 展開、RSS 文章開啟。參考為 Today 選取、不同來源資料；選取樣式與資料夾階層作語意對照。

## Findings

無待修正 P0/P1/P2。使用者要求參考 Feedly 且以 Obsidian 主題繼承優先，因此保留 Obsidian 配色、字型、圖示與既有 MVP 名稱，不加入 AI Feed 或 Boards。

- Typography：介面使用 font-interface，文章使用 font-text/font-text-size，側欄標題截斷、計數不擠壓；字重由原生導航變數決定。
- Spacing：單列約 32 px，分區留白、右側計數與縮排來源對齊；資料夾箭頭和選取名稱分開，避免收合時誤切範圍。
- Colors：明暗模式均跟隨原生 token，文章與按鈕可讀；原有 focus accent 保留。
- Assets：使用 Obsidian setIcon 提供的圖示；無 raster 素材或生成圖片需求。
- Copy：Today／Unread／Saved／Read、管理／更新／批次已讀及 Feeds 分區對應實際功能。

## 驗證與歷程

首次新版畫面與參考共同檢查，未發現需再迭代的 P0/P1/P2。實測資料夾收合、文章開啟及未讀數更新，再切換 Light 並還原 Adapt to system，截圖保留兩種配色。Build 通過，62 個一般測試通過。

## 限制與後續

- 第三方 themes 未安裝／未驗證；只驗證 Default 明暗切換。
- 這次未擷取原生開發者 console，不能聲稱 console 無錯誤。
- 文章列表原有批次操作在窄欄較密集，可在後續調整；本次重點為來源側欄與主題繼承。


## 閱讀流程後續驗收

依使用者新要求改為列表→全文，舊雙欄不再是設計目標。未提供 Feedly 右側畫面，因此依明確互動需求實作，不聲稱 Feedly 像素級複製。

證據：`docs/history/2026-09-22-rss-reader-mvp/screenshots/reader-list.png` 與 `reader-article.png`，共同檢視兩個完整視窗。新版列表有來源／標題／日期欄，全文保留適當閱讀寬度與原生字型、配色；側欄及閱讀工具均可見。原先窄列表批次操作密集問題，以全寬列表與可展開 Reading actions 解決。圖片為既有原生 UI，沒有新增資產。實測選來源、點文章、j/k 與 Esc，64 個測試通過。未見待修正 P0/P1/P2；原有第三方 theme／console 驗證限制仍適用。

final result: passed
