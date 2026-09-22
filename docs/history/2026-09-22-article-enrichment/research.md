# 技術查證

查證日期：2026-09-22。僅採官方文件／原始碼；未複製 RSS Dashboard 實作。

- [RSS Dashboard fetch-helpers](https://github.com/amatya-aditya/obsidian-rss-dashboard/blob/master/src/utils/fetch-helpers.ts)：HTTP → DOMParser → Mozilla Readability；有阻擋 heuristic 與 proxy fallback。本次只借鏡擷取管線，不引入 proxy 或付費牆處理。
- [RSS Dashboard full-article-fetch](https://github.com/amatya-aditya/obsidian-rss-dashboard/blob/master/src/utils/full-article-fetch.ts)：部分 fallback 可回摘要，不等於完整全文，因此本插件不宣稱網站完整性。
- [Web Clipper 預設模板](https://github.com/obsidianmd/obsidian-clipper/blob/main/src/managers/template-manager.ts)：source={{url}}，正文={{content}}，無固定原文 heading。使用者可改模板，所以保留 URL/正文規則設定。
- [Codex 非互動](https://developers.openai.com/codex/noninteractive/)：exec/stdin/JSONL agent_message；read-only 與 shell_tool/unified_exec 關閉沿用已知設定選項。全域 MCP 並未全面停用，不宣稱完全隔離。
- [Claude CLI](https://code.claude.com/docs/en/cli-reference)：print/json result；--tools "" 與 --disallowedTools "mcp__*" 禁用內建及 MCP 工具。
- [OpenCode CLI](https://opencode.ai/docs/cli/) 與 [run.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)：run 接受 stdin、JSON text part；cwd 與環境 PWD 需同步。使用 OPENCODE_PERMISSION 拒絕工具。
- [pi coding agent](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)：print 模式及 no-tools/no-extensions/no-skills。

CLI 版本可能改動。內建參數可編輯，但輸出格式需符合 adapter；mock 協定通過不代表已安裝版本互通通過。
