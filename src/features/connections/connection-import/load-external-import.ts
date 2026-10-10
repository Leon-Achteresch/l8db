import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  type DataGripFile,
  DBEAVER_CREDENTIALS,
  type ExternalImportSource,
  type ExternalParseResult,
  fileName,
  needsDataGripSshConfigs,
  parseDataGripConfig,
  parseDbeaverConfig,
  parseNavicatExport,
} from "@/lib/connection-import";
import {
  type DbeaverWorkspace,
  decryptNavicatLegacyPasswords,
  detectDbeaverWorkspace,
  detectJetbrainsSshConfigs,
  readDbeaverWorkspace,
} from "@/lib/db";

export interface LoadedExternalImport {
  files: string[];
  result: ExternalParseResult;
  dataGripFiles: DataGripFile[];
  needsSshConfigs: boolean;
}

async function fromDbeaver(workspace: DbeaverWorkspace): Promise<LoadedExternalImport> {
  const credentials = workspace.credentials ? base64ToBytes(workspace.credentials) : null;
  const result = await parseDbeaverConfig(workspace.data_sources, credentials);
  const name = fileName(workspace.data_sources_path);
  return {
    files: credentials ? [name, DBEAVER_CREDENTIALS] : [name],
    result,
    dataGripFiles: [],
    needsSshConfigs: false,
  };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function selectedPaths(picked: string | string[] | null): string[] {
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

async function readPicked(paths: string[]): Promise<DataGripFile[]> {
  return Promise.all(
    paths.map(async (path) => ({ name: fileName(path), text: await readTextFile(path) })),
  );
}

export async function loadDataGripFiles(
  files: DataGripFile[],
  detect = true,
): Promise<LoadedExternalImport> {
  let all = files;
  let result = parseDataGripConfig(all);
  if (detect && needsDataGripSshConfigs(result)) {
    const detected = await detectJetbrainsSshConfigs().catch(() => []);
    if (detected.length) {
      all = [...files, ...detected.map((file) => ({ name: file.name, text: file.text }))];
      result = parseDataGripConfig(all);
    }
  }
  return {
    files: all.map((file) => file.name),
    result,
    dataGripFiles: all,
    needsSshConfigs: needsDataGripSshConfigs(result),
  };
}

export async function addDataGripSshConfigs(
  current: DataGripFile[],
): Promise<LoadedExternalImport | null> {
  const paths = selectedPaths(
    await openFileDialog({
      multiple: true,
      directory: false,
      title: "sshConfigs.xml aus dem IDE-Ordner options wählen",
      filters: [{ name: "JetBrains SSH-Konfiguration (XML)", extensions: ["xml"] }],
    }),
  );
  if (!paths.length) return null;
  return loadDataGripFiles([...(await readPicked(paths)), ...current], false);
}

export async function pickExternalImport(
  source: ExternalImportSource,
): Promise<LoadedExternalImport | null> {
  if (source === "dbeaver") {
    const [path] = selectedPaths(
      await openFileDialog({
        multiple: false,
        directory: false,
        title: "DBeaver data-sources.json wählen",
        filters: [{ name: "DBeaver (data-sources.json)", extensions: ["json"] }],
      }),
    );
    if (!path) return null;
    return fromDbeaver(await readDbeaverWorkspace(path));
  }
  if (source === "datagrip") {
    const paths = selectedPaths(
      await openFileDialog({
        multiple: true,
        directory: false,
        title: "dataSources.xml und dataSources.local.xml wählen",
        filters: [{ name: "DataGrip / JetBrains (XML)", extensions: ["xml"] }],
      }),
    );
    if (!paths.length) return null;
    return loadDataGripFiles(await readPicked(paths));
  }
  const [path] = selectedPaths(
    await openFileDialog({
      multiple: false,
      directory: false,
      title: "Navicat-Export (.ncx) wählen",
      filters: [{ name: "Navicat (.ncx)", extensions: ["ncx", "xml"] }],
    }),
  );
  if (!path) return null;
  const result = await parseNavicatExport(await readTextFile(path), decryptNavicatLegacyPasswords);
  return { files: [fileName(path)], result, dataGripFiles: [], needsSshConfigs: false };
}

export async function detectDbeaverImport(): Promise<LoadedExternalImport | null> {
  const workspace = await detectDbeaverWorkspace();
  return workspace ? fromDbeaver(workspace) : null;
}
