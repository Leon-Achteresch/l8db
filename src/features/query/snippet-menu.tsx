import { CodeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSnippetsStore, type Snippet } from "@/lib/snippets";

interface SnippetMenuProps {
  onInsert: (snippet: Snippet) => void;
  onManage: () => void;
}

export function SnippetMenu({ onInsert, onManage }: SnippetMenuProps) {
  const snippets = useSnippetsStore((state) => state.snippets);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3 text-xs"
          title="Snippet einfügen oder verwalten"
        >
          <CodeIcon className="size-3" />
          Snippets
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Einfügen</DropdownMenuLabel>
        {snippets.length === 0 && (
          <DropdownMenuItem disabled className="text-xs">
            Noch keine Snippets
          </DropdownMenuItem>
        )}
        {snippets.map((snippet) => (
          <DropdownMenuItem
            key={snippet.id}
            className="flex flex-col items-start gap-0.5 text-xs"
            onSelect={() => onInsert(snippet)}
          >
            <span className="truncate font-medium">{snippet.name}</span>
            <span className="truncate text-muted-foreground">
              {snippet.shortcut}
              {snippet.category ? ` · ${snippet.category}` : ""}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onSelect={onManage}>
          Snippets verwalten…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
