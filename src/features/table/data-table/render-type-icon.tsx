import {
  BinaryIcon,
  BracesIcon,
  CalendarIcon,
  FingerprintIcon,
  HashIcon,
  KeyIcon,
  TypeIcon,
} from "lucide-react";

export function renderTypeIcon(iconName: string, className?: string) {
  switch (iconName) {
    case "Key":
      return <KeyIcon className={className} />;
    case "Fingerprint":
      return <FingerprintIcon className={className} />;
    case "Hash":
      return <HashIcon className={className} />;
    case "Binary":
      return <BinaryIcon className={className} />;
    case "Calendar":
      return <CalendarIcon className={className} />;
    case "Braces":
      return <BracesIcon className={className} />;
    default:
      return <TypeIcon className={className} />;
  }
}
