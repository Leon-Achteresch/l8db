import { Link } from "@tanstack/react-router";
import { FileText, FolderGit, Heart, Scale, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const LINKS = [
  {
    icon: FolderGit,
    label: "Repository",
    href: "https://github.com/Leon-Achteresch/l8db",
  },
  {
    icon: ShieldCheck,
    label: "Security",
    href: "https://github.com/Leon-Achteresch/l8db/blob/main/SECURITY.md",
  },
];

export function AboutFooter() {
  return (
    <footer className="rounded-3xl border bg-card px-6 py-6 sm:px-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt=""
            className="size-8 rounded-lg object-contain ring-1 ring-border"
          />
          <div>
            <p className="text-sm font-medium leading-tight">l8db · v0.1.0</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Scale className="size-3" />
              MIT · von Leon Achteresch
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild className="rounded-full">
            <Link to="/release-notes">
              <FileText data-icon="inline-start" />
              Release Notes
            </Link>
          </Button>
          {LINKS.map((link) => (
            <Button key={link.label} variant="outline" size="sm" asChild className="rounded-full">
              <a href={link.href} target="_blank" rel="noreferrer">
                <link.icon data-icon="inline-start" />
                {link.label}
              </a>
            </Button>
          ))}
        </div>
      </div>
      <Separator className="my-5" />
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        Mit
        <Heart className="size-3.5 fill-destructive/70 text-destructive/70" />
        für alle gebaut, die täglich mit Daten arbeiten.
      </p>
    </footer>
  );
}
