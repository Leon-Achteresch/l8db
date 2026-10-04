import type { Action } from "@/lib/db/automation";
import { AlertStepForm } from "./steps/alert-step-form";
import { BackupStepForm } from "./steps/backup-step-form";
import { CheckStepForm } from "./steps/check-step-form";
import { CleanupStepForm } from "./steps/cleanup-step-form";
import { CompareStepForm } from "./steps/compare-step-form";
import { ConditionStepForm } from "./steps/condition-step-form";
import { DatagenStepForm } from "./steps/datagen-step-form";
import { ExportStepForm } from "./steps/export-step-form";
import { FailStepForm } from "./steps/fail-step-form";
import { FileCopyMoveStepForm } from "./steps/file-copy-move-step-form";
import { FileDeleteStepForm } from "./steps/file-delete-step-form";
import { FileExistsStepForm } from "./steps/file-exists-step-form";
import { HttpStepForm } from "./steps/http-step-form";
import { ImportStepForm } from "./steps/import-step-form";
import { LogStepForm } from "./steps/log-step-form";
import { LoopStepForm } from "./steps/loop-step-form";
import { MkdirStepForm } from "./steps/mkdir-step-form";
import { NotifyStepForm } from "./steps/notify-step-form";
import { RestoreStepForm } from "./steps/restore-step-form";
import { RunTaskStepForm } from "./steps/run-task-step-form";
import { SetVariableStepForm } from "./steps/set-variable-step-form";
import { ShellStepForm } from "./steps/shell-step-form";
import { SqlStepForm } from "./steps/sql-step-form";
import { TableCopyStepForm } from "./steps/table-copy-step-form";
import { TransferStepForm } from "./steps/transfer-step-form";
import { UnzipStepForm } from "./steps/unzip-step-form";
import { WaitStepForm } from "./steps/wait-step-form";
import { ZipStepForm } from "./steps/zip-step-form";

interface Props {
  action: Action;
  onChange: (action: Action) => void;
}

export function StepActionForm({ action, onChange }: Props) {
  switch (action.type) {
    case "sql":
      return <SqlStepForm action={action} onChange={onChange} />;
    case "export":
      return <ExportStepForm action={action} onChange={onChange} />;
    case "backup":
      return <BackupStepForm action={action} onChange={onChange} />;
    case "restore":
      return <RestoreStepForm action={action} onChange={onChange} />;
    case "transfer":
      return <TransferStepForm action={action} onChange={onChange} />;
    case "table_copy":
      return <TableCopyStepForm action={action} onChange={onChange} />;
    case "datagen":
      return <DatagenStepForm action={action} onChange={onChange} />;
    case "import":
      return <ImportStepForm action={action} onChange={onChange} />;
    case "compare":
      return <CompareStepForm action={action} onChange={onChange} />;
    case "check":
      return <CheckStepForm action={action} onChange={onChange} />;
    case "alert":
      return <AlertStepForm action={action} onChange={onChange} />;
    case "shell":
      return <ShellStepForm action={action} onChange={onChange} />;
    case "http":
      return <HttpStepForm action={action} onChange={onChange} />;
    case "file_delete":
      return <FileDeleteStepForm action={action} onChange={onChange} />;
    case "mkdir":
      return <MkdirStepForm action={action} onChange={onChange} />;
    case "file_exists":
      return <FileExistsStepForm action={action} onChange={onChange} />;
    case "zip":
      return <ZipStepForm action={action} onChange={onChange} />;
    case "unzip":
      return <UnzipStepForm action={action} onChange={onChange} />;
    case "cleanup":
      return <CleanupStepForm action={action} onChange={onChange} />;
    case "notify":
      return <NotifyStepForm action={action} onChange={onChange} />;
    case "wait":
      return <WaitStepForm action={action} onChange={onChange} />;
    case "log":
      return <LogStepForm action={action} onChange={onChange} />;
    case "fail":
      return <FailStepForm action={action} onChange={onChange} />;
    case "condition":
      return <ConditionStepForm action={action} onChange={onChange} />;
    case "set_variable":
      return <SetVariableStepForm action={action} onChange={onChange} />;
    case "run_task":
      return <RunTaskStepForm action={action} onChange={onChange} />;
    case "loop":
      return <LoopStepForm action={action} onChange={onChange} />;
    case "file_copy":
    case "file_move":
      return <FileCopyMoveStepForm action={action} onChange={onChange} />;
  }
}
