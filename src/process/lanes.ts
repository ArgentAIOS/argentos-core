export const enum CommandLane {
  Main = "main",
  Interactive = "interactive",
  Cron = "cron",
  Subagent = "subagent",
  Nested = "nested",
  Background = "background",
}

export const USER_FACING_COMMAND_LANES = [CommandLane.Main, CommandLane.Interactive] as const;
