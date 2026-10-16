import { invoke } from "./core";

export interface TeamUser {
  email: string;
  name: string;
}

export interface TeamPayload {
  name?: string;
  user?: TeamUser;
  connections?: unknown[];
}

export interface TeamLogin {
  hub: string;
  user: TeamUser;
}

export function teamLogin(hubUrl: string): Promise<TeamLogin> {
  return invoke<TeamLogin>("team_login", { hubUrl });
}

export function teamCancelLogin(): Promise<void> {
  return invoke<void>("team_cancel_login");
}

export function teamConnections(hubUrl: string): Promise<TeamPayload> {
  return invoke<TeamPayload>("team_connections", { hubUrl });
}

export function teamLogout(hubUrl: string): Promise<void> {
  return invoke<void>("team_logout", { hubUrl });
}

export interface ManagedHub {
  url: string;
}

export function teamManagedHub(): Promise<ManagedHub | null> {
  return invoke<ManagedHub | null>("team_managed_hub");
}
