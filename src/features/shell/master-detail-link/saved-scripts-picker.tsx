import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { qualifyMasterDetail, useMasterDetail } from "@/lib/master-detail";

interface SavedScriptsPickerProps {
  savedKey: string;
  setSavedKey: (value: string) => void;
  loadDraft: (value: string) => void;
}

export function SavedScriptsPicker({ savedKey, setSavedKey, loadDraft }: SavedScriptsPickerProps) {
  const savedScripts = useMasterDetail((state) => state.savedScripts);
  return (
    <details className="shrink-0 rounded-md border px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Gespeicherte SQL-Vorlagen
      </summary>
      <div className="mt-2 flex items-center gap-2">
        <Select value={savedKey} onValueChange={setSavedKey}>
          <SelectTrigger className="min-w-0 flex-1" aria-label="Gespeichertes Master-Detail-SQL">
            <SelectValue placeholder="Gespeichertes Tabellenpaar auswählen" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(savedScripts).map(([id, entry]) => (
              <SelectItem key={id} value={id}>
                {entry.master} → {entry.detail}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={!savedScripts[savedKey]}
          onClick={() => {
            loadDraft(
              qualifyMasterDetail(savedScripts[savedKey].sql, savedScripts[savedKey].column),
            );
          }}
        >
          SQL laden
        </Button>
        <Button
          variant="ghost"
          disabled={!savedScripts[savedKey]}
          onClick={() => {
            useMasterDetail.getState().removeSavedScript(savedKey);
            setSavedKey("");
          }}
        >
          Vorlage löschen
        </Button>
      </div>
    </details>
  );
}
