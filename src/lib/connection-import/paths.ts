export function dbeaverWorkspaceDirs(home: string): string[] {
  const base = home.replace(/[\\/]+$/, "");
  if (!base) return [];
  const suffix = "DBeaverData/workspace6/General/.dbeaver";
  return [
    `${base}/.local/share/${suffix}`,
    `${base}/Library/${suffix}`,
    `${base}/AppData/Roaming/${suffix}`,
    `${base}/.var/app/io.dbeaver.DBeaverCommunity/data/${suffix}`,
    `${base}/snap/dbeaver-ce/current/.local/share/${suffix}`,
  ];
}

export function siblingPath(file: string, name: string): string {
  const index = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return index < 0 ? name : `${file.slice(0, index + 1)}${name}`;
}

export function fileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}
