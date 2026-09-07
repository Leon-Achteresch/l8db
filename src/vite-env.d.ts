/// <reference types="vite/client" />

declare module "monaco-editor/esm/vs/basic-languages/sql/sql" {
  import type { languages } from "monaco-editor";
  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage;
}

declare module "monaco-editor/esm/vs/editor/editor.api" {
  export * from "monaco-editor";
}
