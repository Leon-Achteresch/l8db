import anthropic from "thesvg/anthropic";
import gemini from "thesvg/gemini";
import openai from "thesvg/openai";
import { mcpClientSvg } from "@/features/mcp/mcp-client-icons";

const API_ICONS: Record<string, string> = {
  openai: openai.svg,
  anthropic: anthropic.svg.replace('fill="#ffff"', 'fill="currentColor"'),
  google: gemini.svg,
};
const CLI_ICONS: Record<string, string> = {
  codex: "codex",
  claude: "claude-code",
  "gemini-cli": "gemini",
  opencode: "opencode",
  copilot: "copilot",
};

export function aiProviderSvg(id: string): string | null {
  return API_ICONS[id] ?? (CLI_ICONS[id] ? mcpClientSvg(CLI_ICONS[id]) : null);
}
