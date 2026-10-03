# BeUI attribution

Adapted from BeUI by Saurabh Chauhan, https://beui.dev/components/agents, under the MIT license in LICENSE. Registry source snapshots were retrieved on 2026-10-03. Copyright notice is retained in LICENSE.

These components are isolated to the AI workspace. Global application primitives are unchanged. Original registry modules were split into one component per file, imports were localized, and code comments removed under project rules. Shiki uses local SQL, Bash, Diff, JSON, TSX and TypeScript grammars, two local themes and the JavaScript regex engine. Citation icons do not request remote favicons.

| BeUI component | Registry source | Actual workspace use |
| --- | --- | --- |
| message-bubble | https://beui.dev/r/message-bubble.json | AiTranscript user messages |
| message | https://beui.dev/r/message.json | AiTranscript transcript entries |
| message-scroller | https://beui.dev/r/message-scroller.json | AiTranscript scroll container |
| prompt-input | https://beui.dev/r/prompt-input.json | AiView composer |
| todo-list | https://beui.dev/r/todo-list.json | AiRichContent native plans |
| code-block | https://beui.dev/r/code-block.json | AiAnswer fenced SQL and code |
| approval-card | https://beui.dev/r/approval-card.json | AiApproval native questions and schema forms |
| file-diff | https://beui.dev/r/file-diff.json | AiRichContent native file changes |
| tool-result | https://beui.dev/r/tool-result.json | AiRichContent native tool outputs |
| streaming-response | https://beui.dev/r/streaming-response.json | AiAnswer streamed and completed answers |
| image-generation | https://beui.dev/r/image-generation.json | AiRichContent native raster image artifacts |
| tool-approval | https://beui.dev/r/tool-approval.json | AiApproval allow-once and deny actions |
| citations | https://beui.dev/r/citations.json | AiRichContent native sources and database provenance |
| agent-activity | https://beui.dev/r/agent-activity.json | AiRichContent collapsed tool activity |
| loading-states | https://beui.dev/r/reasoning-text.json; https://beui.dev/r/thinking-shimmer.json; https://beui.dev/r/agent-progress.json | AiTranscript thinking and AiView native run status |
| ai-sidebar | https://beui.dev/r/ai-sidebar.json | AiView session history navigation |
| chat-app | https://beui.dev/r/chat-app.json | AiView workspace composition |

## Upstream registry file mapping

`registry-manifest.json` records every exact upstream file path, source registry URL and corresponding installed files, including extracted component files. Shared upstream utilities replaced by existing project helpers and the remote favicon dependencies are marked omitted. Loading States is installed from its three published component registries; the grouped registry endpoint does not exist.
