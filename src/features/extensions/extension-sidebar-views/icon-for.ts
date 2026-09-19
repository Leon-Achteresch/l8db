import {
  BracesIcon,
  DatabaseIcon,
  EyeIcon,
  FileCodeIcon,
  FileIcon,
  FolderIcon,
  PackageIcon,
  StarIcon,
  TableIcon,
} from "lucide-react";

export function iconFor(name: string | undefined) {
  switch (name) {
    case "folder":
      return FolderIcon;
    case "file":
      return FileIcon;
    case "database":
      return DatabaseIcon;
    case "table":
      return TableIcon;
    case "eye":
      return EyeIcon;
    case "code":
      return FileCodeIcon;
    case "package":
      return PackageIcon;
    case "star":
      return StarIcon;
    case "braces":
      return BracesIcon;
    default:
      return FileIcon;
  }
}
