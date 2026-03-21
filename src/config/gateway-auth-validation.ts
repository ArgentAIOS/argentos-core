import type { ArgentConfig } from "./types.js";

export type GatewayAuthConfigIssue = {
  code: "token-mode-missing-token" | "password-mode-missing-password";
  path: "gateway.auth.token" | "gateway.auth.password";
  message: string;
};

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateGatewayAuthConfig(config: ArgentConfig): GatewayAuthConfigIssue[] {
  const mode = asTrimmed(config.gateway?.auth?.mode).toLowerCase();
  const token = asTrimmed(config.gateway?.auth?.token);
  const password = asTrimmed(config.gateway?.auth?.password);

  if (mode === "token" && token.length === 0) {
    return [
      {
        code: "token-mode-missing-token",
        path: "gateway.auth.token",
        message:
          'gateway.auth.mode is "token" but gateway.auth.token is empty. Set gateway.auth.token to a non-empty value or switch gateway.auth.mode to "password".',
      },
    ];
  }

  if (mode === "password" && password.length === 0) {
    return [
      {
        code: "password-mode-missing-password",
        path: "gateway.auth.password",
        message:
          'gateway.auth.mode is "password" but gateway.auth.password is empty. Set gateway.auth.password to a non-empty value or switch gateway.auth.mode to "token".',
      },
    ];
  }

  return [];
}
