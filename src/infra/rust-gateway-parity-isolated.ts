import type { RustGatewayParityFixture } from "./rust-gateway-parity-fixtures.js";
import {
  runRustGatewayParityReplay,
  type RustGatewayParityReplayReport,
} from "./rust-gateway-parity-runner.js";
import {
  createRustGatewayWsParityTransport,
  type RustGatewayParityWsTransportOptions,
} from "./rust-gateway-parity-ws-transport.js";

export type RustGatewayParityServiceHandle = {
  url: string;
  stop: () => Promise<void> | void;
};

export type RustGatewayParityServiceStarter = () => Promise<RustGatewayParityServiceHandle>;

export type IsolatedRustGatewayParityOptions = {
  startNodeGateway: RustGatewayParityServiceStarter;
  startRustGateway: RustGatewayParityServiceStarter;
  fixtures?: RustGatewayParityFixture[];
  token?: string;
  timeoutMs?: number;
  nowMs?: () => number;
  webSocketFactory?: RustGatewayParityWsTransportOptions["webSocketFactory"];
};

export async function runIsolatedRustGatewayParity(
  options: IsolatedRustGatewayParityOptions,
): Promise<RustGatewayParityReplayReport> {
  const started: RustGatewayParityServiceHandle[] = [];
  try {
    const node = await options.startNodeGateway();
    started.push(node);
    const rust = await options.startRustGateway();
    started.push(rust);

    const transport = createRustGatewayWsParityTransport({
      nodeUrl: node.url,
      rustUrl: rust.url,
      token: options.token,
      timeoutMs: options.timeoutMs,
      webSocketFactory: options.webSocketFactory,
    });

    return await runRustGatewayParityReplay({
      fixtures: options.fixtures,
      transport,
      nowMs: options.nowMs,
    });
  } finally {
    const stops = started.toReversed().map(async (service) => {
      await service.stop();
    });
    await Promise.all(stops);
  }
}
