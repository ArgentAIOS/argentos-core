declare module "@coinbase/agentkit" {
  export const AgentKit: {
    from(params: Record<string, unknown>): Promise<{
      wallet: {
        getDefaultAddress(): Promise<{ getId(): string }>;
      };
    }>;
  };
}
