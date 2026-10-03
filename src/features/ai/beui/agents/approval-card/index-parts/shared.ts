import type { ApprovalCardAnswer, ApprovalCardStatus } from "../types";

export type {
  ApprovalCardAnswer,
  ApprovalCardAnswers,
  ApprovalCardOption,
  ApprovalCardProps,
  ApprovalCardQuestion,
  ApprovalCardStatus,
} from "../types";
export const EMPTY_ANSWER: ApprovalCardAnswer = { selected: [], custom: "" };
export function getStatusLabel(status: ApprovalCardStatus) {
  if (status === "submitting") return "Wird gesendet";
  if (status === "approved") return "Erlaubt";
  if (status === "rejected") return "Abgelehnt";
  if (status === "changes-requested") return "Änderungen angefragt";
  if (status === "answered") return "Antwort gesendet";
  return "Antwort erforderlich";
}
export function getStatusClass(status: ApprovalCardStatus) {
  if (status === "approved" || status === "answered") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (status === "rejected") return "text-rose-600 dark:text-rose-400";
  if (status === "changes-requested") {
    return "text-amber-600 dark:text-amber-400";
  }
  return "text-muted-foreground";
}
export function getStatusBadgeClass(status: ApprovalCardStatus) {
  if (status === "pending" || status === "changes-requested") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
  if (status === "submitting") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400";
  }
  if (status === "approved" || status === "answered") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  return "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400";
}
export function isAnswered(answer: ApprovalCardAnswer) {
  return answer.selected.length > 0 || Boolean(answer.custom?.trim());
}
