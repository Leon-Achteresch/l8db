import { useQuery } from "@tanstack/react-query";
import { encode, readFile, saveFile } from "@/lib/versioning/repository";
import {
  DEFAULT_TICKETS,
  parseTickets,
  TICKETS_PATH,
  type TicketConfiguration,
  validateTickets,
} from "@/lib/versioning/review";
import type { VersioningWorkspace } from "./use-versioning";

export function useTickets(workspace: VersioningWorkspace) {
  const { repo, status } = workspace;
  const query = useQuery({
    queryKey: ["versioning-tickets", repo, status?.head, status?.changes],
    enabled: Boolean(repo && status),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const text = await readFile(repo, TICKETS_PATH);
      try {
        return { text, configuration: parseTickets(text), problem: null };
      } catch (error) {
        return { text, configuration: DEFAULT_TICKETS, problem: String(error) };
      }
    },
  });
  const save = async (configuration: TicketConfiguration) => {
    await saveFile(
      repo,
      TICKETS_PATH,
      encode(validateTickets(configuration)),
      query.data?.text ?? null,
    );
    await workspace.refresh();
  };
  return {
    configuration: query.data?.configuration ?? DEFAULT_TICKETS,
    configured: Boolean(query.data?.text),
    problem: query.data?.problem ?? null,
    save,
  };
}

export type TicketsState = ReturnType<typeof useTickets>;
