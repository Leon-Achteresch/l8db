import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { editorAiSupported, inlineSupported } from "@/lib/ai/editor/client";
import { useEditorAiSettings } from "@/lib/ai/editor/settings";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import { Row } from "./row";
import { Section } from "./section";
import { SliderValue } from "./slider-value";

const CHAT = "__chat";

export function EditorAiSection({ compact }: { compact: boolean }) {
  const settings = useEditorAiSettings();
  const profiles = useAiStore((state) => state.profiles);
  const chatProfileId = useAiStore((state) => state.profileId);
  const effective =
    profiles.find((profile) => profile.id === settings.profileId) ??
    profiles.find((profile) => profile.id === chatProfileId) ??
    profiles[0];
  const name = (id: string) => AI_PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
  const status = !effective
    ? "Noch kein KI-Anbieter eingerichtet."
    : !editorAiSupported(effective)
      ? `${name(effective.provider)} wird im Editor nicht unterstützt. Claude Code, Codex oder einen API- bzw. lokalen Anbieter wählen.`
      : !inlineSupported(effective)
        ? `${name(effective.provider)}: ⌘I und KI-Aktionen aktiv. Ghost-Text braucht einen API- oder lokalen Anbieter.`
        : `${name(effective.provider)}${effective.model ? ` · ${effective.model}` : ""}: alle Editor-Funktionen aktiv.`;
  const off = !settings.enabled;

  return (
    <Section
      title="KI im Editor"
      description="Wie in Cursor: Ghost-Text, Bearbeiten mit ⌘I und Diff, Aktionen im Kontextmenü. Der Kontext wird kompakt gehalten, um Tokens zu sparen."
    >
      <Row
        settingId="editor-ai"
        featureId={compact ? undefined : "settings.editor.ai"}
        compact={compact}
      >
        <Switch
          checked={settings.enabled}
          onCheckedChange={(enabled) => settings.update({ enabled })}
          aria-label="KI im Editor"
        />
      </Row>
      <p className="text-[11px] leading-snug text-muted-foreground" aria-live="polite">
        {status}
      </p>
      <Row settingId="editor-ai-inline" compact={compact}>
        <Switch
          checked={settings.inline}
          disabled={off}
          onCheckedChange={(inline) => settings.update({ inline })}
          aria-label="Ghost-Text-Vorschläge"
        />
      </Row>
      <Row settingId="editor-ai-delay" compact={compact}>
        <div className="flex w-40 items-center gap-2">
          <Slider
            min={100}
            max={1500}
            step={50}
            disabled={off || !settings.inline}
            value={[settings.inlineDelay]}
            onValueChange={([value]) =>
              value !== undefined && settings.update({ inlineDelay: value })
            }
            aria-label="Wartezeit für Ghost-Text"
          />
          <SliderValue value={String(settings.inlineDelay)} unit="ms" />
        </div>
      </Row>
      <Row settingId="editor-ai-codelens" compact={compact}>
        <Switch
          checked={settings.codeLens}
          disabled={off}
          onCheckedChange={(codeLens) => settings.update({ codeLens })}
          aria-label="KI-Aktionen über Anweisungen"
        />
      </Row>
      <Row settingId="editor-ai-next-edit" compact={compact}>
        <Switch
          checked={settings.nextEdit}
          onCheckedChange={(nextEdit) => settings.update({ nextEdit })}
          aria-label="Umbenennung weiterführen"
        />
      </Row>
      <Row settingId="editor-ai-profile" compact={compact}>
        <Select
          value={settings.profileId || CHAT}
          disabled={off}
          onValueChange={(value) => settings.update({ profileId: value === CHAT ? "" : value })}
        >
          <SelectTrigger
            size="sm"
            className="h-8 w-48 text-xs"
            aria-label="Anbieter für den Editor"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CHAT} className="text-xs">
              Wie im Chat
            </SelectItem>
            {profiles
              .filter((profile) => editorAiSupported(profile))
              .map((profile) => (
                <SelectItem key={profile.id} value={profile.id} className="text-xs">
                  {name(profile.provider)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Row>
      <Row settingId="editor-ai-fast-model" compact={compact}>
        <Input
          value={settings.fastModel}
          disabled={off}
          onChange={(event) => settings.update({ fastModel: event.target.value })}
          placeholder={effective?.model || "Standardmodell"}
          spellCheck={false}
          aria-label="Schnelles Modell"
          className="h-8 w-48 font-mono text-xs"
        />
      </Row>
      <Row settingId="editor-ai-validate" compact={compact}>
        <Switch
          checked={settings.validate}
          disabled={off}
          onCheckedChange={(validate) => settings.update({ validate })}
          aria-label="KI-Vorschläge prüfen"
        />
      </Row>
      <Row settingId="editor-ai-share-values" compact={compact}>
        <Switch
          checked={settings.shareValues}
          disabled={off}
          onCheckedChange={(shareValues) => settings.update({ shareValues })}
          aria-label="Ergebniswerte an die KI senden"
        />
      </Row>
    </Section>
  );
}
