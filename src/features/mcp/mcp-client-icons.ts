import claudeDesktop from "thesvg/claude";
import claudeCode from "thesvg/claude-code";
import codex from "thesvg/codex";
import cursor from "thesvg/cursor";
import geminiCli from "thesvg/gemini-cli";
import githubCopilot from "thesvg/github-copilot";
import opencode from "thesvg/opencode";
import vscode from "thesvg/visual-studio-code";
import windsurf from "thesvg/windsurf";

const CLIENT_ICONS: Record<string, string> = {
  "claude-code": claudeCode.svg,
  "claude-desktop": claudeDesktop.svg,
  codex: codex.svg.replace('fill="#111"', 'fill="currentColor"'),
  copilot: githubCopilot.svg,
  gemini: geminiCli.svg,
  cursor: cursor.svg.replace("<svg ", '<svg fill="currentColor" '),
  windsurf: windsurf.svg,
  opencode: opencode.svg,
  vscode: vscode.svg,
};

export function mcpClientSvg(id: string): string | null {
  return CLIENT_ICONS[id] ?? null;
}
