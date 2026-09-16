import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Blocks, Command, Download, GitBranch, Menu, Terminal } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { AppLogo } from "@/components/app-logo";
import { type CommandItem, CommandPalette } from "@/components/motion/command-palette";
import { ThemeToggle } from "@/components/motion/theme-toggle";

const RELEASES_URL = "https://github.com/Leon-Achteresch/l8db/releases/latest";

export function AboutNav() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const commands: CommandItem[] = [
    {
      id: "download",
      label: "Download öffnen",
      group: "l8db",
      hint: "↵",
      icon: Download,
      onSelect: () => window.open(RELEASES_URL, "_blank", "noopener,noreferrer"),
    },
    {
      id: "features",
      label: "Funktionen ansehen",
      group: "l8db",
      hint: "F",
      icon: Blocks,
      onSelect: () => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" }),
    },
    {
      id: "workspace",
      label: "Arbeitsplatz öffnen",
      group: "l8db",
      hint: "W",
      icon: Terminal,
      onSelect: () => {
        window.location.href = "/connections";
      },
    },
    {
      id: "github",
      label: "Quellcode öffnen",
      group: "Links",
      icon: GitBranch,
      onSelect: () => window.open("https://github.com/Leon-Achteresch/l8db", "_blank"),
    },
  ];

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="about-nav sticky top-0 z-20 mx-auto flex w-full max-w-[1360px] items-center justify-between px-5 py-4 sm:px-8 lg:px-10"
      >
        <Link to="/about" className="flex items-center gap-2.5" aria-label="l8db Startseite">
          <AppLogo alt="" className="size-8 ring-1 ring-black/10 dark:ring-white/15" />
          <span className="text-[15px] font-semibold tracking-[-0.04em]">l8db</span>
        </Link>

        <nav
          className="hidden items-center gap-7 text-[12px] font-medium text-current/55 md:flex"
          aria-label="Landingpage"
        >
          <a className="transition-colors hover:text-current" href="#features">
            Funktionen
          </a>
          <a className="transition-colors hover:text-current" href="#workflow">
            Arbeitsweise
          </a>
          <a className="transition-colors hover:text-current" href="#download">
            Download
          </a>
        </nav>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-2 rounded-full border border-current/10 bg-current/[0.04] px-3 text-[11px] text-current/55 transition-colors hover:bg-current/[0.08] hover:text-current sm:flex"
          >
            <Command className="size-3" />
            Schnellzugriff
            <kbd className="rounded border border-current/10 px-1 py-0.5 font-mono text-[9px]">
              ⌘K
            </kbd>
          </button>
          <ThemeToggle
            variant="circle-blur"
            start="top-right"
            className="size-8 rounded-full text-current/60 transition-colors hover:bg-current/[0.08] hover:text-current"
            iconClassName="size-4"
          />
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="about-nav-download hidden h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold sm:inline-flex"
          >
            Download
            <ArrowUpRight className="size-3.5" />
          </a>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Menü öffnen"
            className="grid size-8 place-items-center rounded-full border border-current/10 bg-current/[0.04] text-current/65 sm:hidden"
          >
            <Menu className="size-4" />
          </button>
        </div>
      </motion.header>
      <CommandPalette
        items={commands}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        placeholder="Was möchtest du öffnen?"
        emptyMessage="Nichts gefunden."
        maxVisible={6}
      />
    </>
  );
}
