import { PlusIcon, StarIcon, Trash2Icon, VariableIcon } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { newId } from "@/lib/automation/defaults";
import { VARIABLE_KIND_LABELS } from "@/lib/automation/labels";
import { pinSecretId, variableSecretAccount } from "@/lib/automation/secrets";
import { toast } from "@/lib/automation/toast";
import { fieldIssue } from "@/lib/automation/validation";
import type {
  Environment,
  Task,
  ValidationIssue,
  Variable,
  VariableKind,
} from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { ChipsInput } from "./chips-input";
import { FormRow } from "./form-row";
import { SecretValueField } from "./secret-value-field";
import { VariableDefaultInput } from "./variable-default-input";

interface Props {
  task: Task;
  issues: ValidationIssue[];
  onChange: (patch: Partial<Task>) => void;
}

const KINDS = Object.entries(VARIABLE_KIND_LABELS) as [VariableKind, string][];

function freshName(taken: string[], base: string): string {
  let index = taken.length + 1;
  while (taken.includes(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

export function VariablesTab({ task, issues, onChange }: Props) {
  const baseId = useId();
  const added = useRef<string | null>(null);
  const variables = task.variables;
  const environments = task.environments;
  const setVariables = (next: Variable[]) => onChange({ variables: next });
  const setVariable = (index: number, patch: Partial<Variable>) =>
    setVariables(
      variables.map((entry, i) => (i === index ? { ...pinSecretId(entry), ...patch } : entry)),
    );
  const setEnvironments = (next: Environment[], defaultEnvironment = task.defaultEnvironment) =>
    onChange({ environments: next, defaultEnvironment });
  const error = (field: string) => fieldIssue(issues, null, field);
  const matrixKeys = [
    ...variables.map((variable) => variable.name).filter(Boolean),
    ...new Set(
      environments
        .flatMap((env) => Object.keys(env.variables))
        .filter((key) => !variables.some((variable) => variable.name === key)),
    ),
  ];

  const addVariable = () => {
    const id = newId("var");
    added.current = id;
    setVariables([
      ...variables,
      {
        id,
        name: freshName(
          variables.map((variable) => variable.name),
          "variable",
        ),
        kind: "text",
        defaultValue: "",
        choices: [],
        prompt: false,
        description: "",
      },
    ]);
  };

  const removeVariable = (index: number) => {
    const previous = variables;
    setVariables(variables.filter((_, i) => i !== index));
    toast(`Variable „${previous[index].name}“ entfernt`, {
      action: { label: "Rückgängig", onClick: () => setVariables(previous) },
    });
  };

  const addEnvironment = () => {
    const names = environments.map((env) => env.name);
    const name = !names.includes("produktion")
      ? "produktion"
      : !names.includes("test")
        ? "test"
        : freshName(names, "umgebung");
    setEnvironments(
      [...environments, { id: newId("env"), name, variables: {} }],
      task.defaultEnvironment ?? name,
    );
  };

  const renameEnvironment = (index: number, name: string) => {
    const previous = environments[index].name;
    setEnvironments(
      environments.map((env, i) => (i === index ? { ...pinSecretId(env), name } : env)),
      task.defaultEnvironment === previous ? name : task.defaultEnvironment,
    );
  };

  const removeEnvironment = (index: number) => {
    const removed = environments[index];
    const before = { environments, defaultEnvironment: task.defaultEnvironment };
    const next = environments.filter((_, i) => i !== index);
    setEnvironments(
      next,
      task.defaultEnvironment === removed.name ? (next[0]?.name ?? null) : task.defaultEnvironment,
    );
    toast(`Umgebung „${removed.name}“ entfernt`, {
      action: { label: "Rückgängig", onClick: () => onChange(before) },
    });
  };

  const setCell = (envIndex: number, key: string, value: string) =>
    setEnvironments(
      environments.map((env, i) => {
        if (i !== envIndex) return env;
        const variablesNext = { ...env.variables };
        if (value) variablesNext[key] = value;
        else delete variablesNext[key];
        return { ...env, variables: variablesNext };
      }),
    );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-5 pt-5 pb-16">
      <section className="flex flex-col gap-4">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold tracking-tight">Variablen</h3>
            <p className="max-w-prose text-xs text-pretty text-muted-foreground">
              In jedem Textfeld als <code className="font-mono text-[11px]">{"${name}"}</code>{" "}
              nutzbar. Ohne Standardwert muss ein Wert aus Umgebung, Zeitplan oder Abfrage kommen.
            </p>
          </div>
          {variables.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={addVariable}>
              <PlusIcon />
              Variable
            </Button>
          )}
        </header>

        {variables.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
            <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
              <VariableIcon className="size-4" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Noch keine Variablen</p>
              <p className="max-w-prose text-xs text-pretty text-muted-foreground">
                Variablen machen einen Task wiederverwendbar: Schema, Zielordner oder Stichtag
                einmal festlegen und überall einsetzen. Eingebaute wie{" "}
                <code className="font-mono text-[11px]">{"${date}"}</code> gibt es immer.
              </p>
            </div>
            <Button type="button" size="sm" onClick={addVariable}>
              <PlusIcon />
              Variable anlegen
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {variables.map((variable, index) => {
              const field = `variables.${index}`;
              const nameError = error(`${field}.name`);
              const valueError = error(`${field}.defaultValue`);
              const choicesError = error(`${field}.choices`);
              return (
                <li
                  key={variable.id || `${index}-${variable.name}`}
                  className={cn(
                    "@container/var grid grid-cols-1 gap-x-3 gap-y-2 px-3 py-3",
                    variable.id === added.current &&
                      "transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_auto] items-center gap-2 @xl/var:grid-cols-[minmax(0,10rem)_8.5rem_minmax(0,1fr)_auto_auto]">
                    <Input
                      aria-label="Name"
                      aria-invalid={Boolean(nameError) || undefined}
                      value={variable.name}
                      spellCheck={false}
                      onChange={(event) => setVariable(index, { name: event.target.value.trim() })}
                      className="h-8 font-mono text-[13px]"
                    />
                    <Select
                      value={variable.kind}
                      onValueChange={(kind) =>
                        setVariable(index, {
                          kind: kind as VariableKind,
                          defaultValue:
                            kind === "boolean"
                              ? "false"
                              : kind === "secret"
                                ? ""
                                : variable.defaultValue,
                        })
                      }
                    >
                      <SelectTrigger aria-label="Typ" className="h-8 w-full rounded-lg text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KINDS.map(([kind, label]) => (
                          <SelectItem key={kind} value={kind}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="col-span-3 flex min-w-0 items-center gap-2 @xl/var:contents">
                      <div className="min-w-0 flex-1">
                        {variable.kind === "secret" ? (
                          <SecretValueField
                            account={variableSecretAccount(task.id, variable)}
                            label={`Wert von ${variable.name}`}
                          />
                        ) : (
                          <VariableDefaultInput
                            variable={variable}
                            invalid={Boolean(valueError)}
                            label={`Standardwert von ${variable.name}`}
                            onChange={(defaultValue) => setVariable(index, { defaultValue })}
                          />
                        )}
                      </div>
                      <div className="flex h-8 items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
                        <Switch
                          id={`${baseId}-prompt-${index}`}
                          checked={variable.prompt}
                          onCheckedChange={(prompt) => setVariable(index, { prompt })}
                        />
                        <label htmlFor={`${baseId}-prompt-${index}`} className="select-none">
                          Vor Lauf fragen
                        </label>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Variable „${variable.name}“ entfernen`}
                      onClick={() => removeVariable(index)}
                      className="col-start-3 row-start-1 size-8 text-muted-foreground hover:text-destructive @xl/var:col-start-5"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  {(nameError || valueError) && (
                    <p className="text-xs text-destructive">{nameError ?? valueError}</p>
                  )}
                  {variable.kind === "choice" && (
                    <FormRow label="Auswahlwerte" error={choicesError} className="max-w-xl">
                      <ChipsInput
                        value={variable.choices}
                        onChange={(choices) => setVariable(index, { choices })}
                        itemLabel="Wert"
                        placeholder="Wert, Enter"
                      />
                    </FormRow>
                  )}
                  <Input
                    aria-label="Beschreibung"
                    value={variable.description}
                    placeholder="Beschreibung (erscheint beim Nachfragen und in der Vervollständigung)"
                    onChange={(event) => setVariable(index, { description: event.target.value })}
                    className="h-7 border-transparent bg-transparent px-1.5 text-xs text-muted-foreground shadow-none hover:border-input focus-visible:text-foreground dark:bg-transparent"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold tracking-tight">Umgebungen</h3>
            <p className="max-w-prose text-xs text-pretty text-muted-foreground">
              Derselbe Task gegen Test und Produktion: Werte je Umgebung überschreiben die
              Standardwerte. Leere Zellen nutzen den Standard.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addEnvironment}>
            <PlusIcon />
            Umgebung
          </Button>
        </header>
        {environments.length > 0 && (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-max border-collapse text-[13px]">
              <thead>
                <tr className="border-b">
                  <th
                    scope="col"
                    className="w-40 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
                  >
                    Variable
                  </th>
                  {environments.map((env, envIndex) => {
                    const isDefault = task.defaultEnvironment === env.name;
                    const nameError = error(`environments.${envIndex}.name`);
                    return (
                      <th
                        key={envIndex}
                        scope="col"
                        className="min-w-52 px-2 py-1.5 text-left font-normal"
                      >
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label="Name der Umgebung"
                            aria-invalid={Boolean(nameError) || undefined}
                            title={nameError ?? undefined}
                            value={env.name}
                            spellCheck={false}
                            onChange={(event) =>
                              renameEnvironment(envIndex, event.target.value.trim())
                            }
                            className="h-7 border-transparent bg-transparent px-1.5 text-[13px] font-semibold shadow-none hover:border-input dark:bg-transparent"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-pressed={isDefault}
                            aria-label={
                              isDefault ? `${env.name} ist Standard` : `${env.name} als Standard`
                            }
                            title={isDefault ? "Standard-Umgebung" : "Als Standard festlegen"}
                            onClick={() => onChange({ defaultEnvironment: env.name })}
                            className={cn(
                              isDefault ? "text-amber-500" : "text-muted-foreground/60",
                            )}
                          >
                            <StarIcon className={cn(isDefault && "fill-current")} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Umgebung ${env.name} entfernen`}
                            onClick={() => removeEnvironment(envIndex)}
                            className="text-muted-foreground/60 hover:text-destructive"
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matrixKeys.length === 0 ? (
                  <tr>
                    <td
                      colSpan={environments.length + 1}
                      className="px-3 py-4 text-xs text-muted-foreground"
                    >
                      Lege oben Variablen an, um Werte je Umgebung zu setzen.
                    </td>
                  </tr>
                ) : (
                  matrixKeys.map((key) => {
                    const variable = variables.find((entry) => entry.name === key);
                    const orphan = !variable;
                    return (
                      <tr key={key} className="border-b last:border-b-0">
                        <th scope="row" className="px-3 py-1.5 text-left font-normal">
                          <span className="flex flex-col">
                            <span
                              className={cn(
                                "font-mono text-[13px]",
                                orphan && "text-muted-foreground",
                              )}
                            >
                              {key}
                            </span>
                            {orphan && (
                              <span className="text-[11px] text-muted-foreground">
                                nur in Umgebungen
                              </span>
                            )}
                          </span>
                        </th>
                        {environments.map((env, envIndex) => (
                          <td key={envIndex} className="px-2 py-1.5">
                            {variable?.kind === "secret" ? (
                              <SecretValueField
                                account={variableSecretAccount(task.id, variable, env)}
                                label={`${key} in ${env.name}`}
                              />
                            ) : (
                              <Input
                                aria-label={`${key} in ${env.name}`}
                                value={env.variables[key] ?? ""}
                                placeholder={
                                  variable?.defaultValue
                                    ? `Standard: ${variable.defaultValue}`
                                    : "Standard"
                                }
                                onChange={(event) => setCell(envIndex, key, event.target.value)}
                                className="h-8 text-[13px]"
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
        {environments.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Mit mehreren Umgebungen fragt „Ausführen“ vor jedem Lauf, welche gilt. Zeitpläne nutzen
            die Standard-Umgebung, außer sie legen eine eigene fest.
          </p>
        )}
      </section>
    </div>
  );
}
