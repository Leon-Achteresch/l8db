import { homeDir } from "@tauri-apps/api/path";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import {
  DBEAVER_CREDENTIALS,
  DBEAVER_DATA_SOURCES,
  dbeaverWorkspaceDirs,
  type ExternalImportSource,
  type ExternalParseResult,
  fileName,
  parseDataGripConfig,
  parseDbeaverConfig,
  parseNavicatExport,
  siblingPath,
} from "@/lib/connection-import";
import { decryptNavicatLegacyPasswords } from "@/lib/db";

export interface LoadedExternalImport {
  files: string[];
  result: ExternalParseResult;
}

async function readOptionalBinary(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function loadDbeaver(dataSourcesPath: string, text: string): Promise<LoadedExternalImport> {
  const credentialsPath = siblingPath(dataSourcesPath, DBEAVER_CREDENTIALS);
  const credentials = await readOptionalBinary(credentialsPath);
  const result = await parseDbeaverConfig(text, credentials);
  return {
    files: credentials
      ? [fileName(dataSourcesPath), fileName(credentialsPath)]
      : [fileName(dataSourcesPath)],
    result,
  };
}

function selectedPaths(picked: string | string[] | null): string[] {
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
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
    return loadDbeaver(path, await readTextFile(path));
  }
  if (source === "datagrip") {
    const paths = selectedPaths(
      await openFileDialog({
        multiple: true,
        directory: false,
        title: "dataSources.xml, dataSources.local.xml und optional sshConfigs.xml wählen",
        filters: [{ name: "DataGrip / JetBrains (XML)", extensions: ["xml"] }],
      }),
    );
    if (!paths.length) return null;
    const files = await Promise.all(
      paths.map(async (path) => ({ name: fileName(path), text: await readTextFile(path) })),
    );
    return { files: files.map((file) => file.name), result: parseDataGripConfig(files) };
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
  return { files: [fileName(path)], result };
}

export async function detectDbeaverImport(): Promise<LoadedExternalImport | null> {
  const home = await homeDir();
  for (const directory of dbeaverWorkspaceDirs(home)) {
    const path = `${directory}/${DBEAVER_DATA_SOURCES}`;
    let text: string;
    try {
      text = await readTextFile(path);
    } catch {
      continue;
    }
    return loadDbeaver(path, text);
  }
  return null;
}
