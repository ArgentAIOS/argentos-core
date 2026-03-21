import type { GatewayRequestHandlers } from "./types.js";
import { discoverConnectorCatalog } from "../../connectors/catalog.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateConnectorsCatalogParams,
} from "../protocol/index.js";

export const connectorsHandlers: GatewayRequestHandlers = {
  "connectors.catalog": async ({ params, respond }) => {
    if (!validateConnectorsCatalogParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.catalog params: ${formatValidationErrors(validateConnectorsCatalogParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const result = await discoverConnectorCatalog();
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INTERNAL_ERROR,
          error instanceof Error ? error.message : "failed to build connector catalog",
        ),
      );
    }
  },
};
