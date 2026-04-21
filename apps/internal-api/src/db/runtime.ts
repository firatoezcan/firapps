import { createDatabaseRuntime } from "@firapps/db";

import { internalApiEnv } from "../config.js";
import * as schema from "./schema.js";

void internalApiEnv;

export const runtime = createDatabaseRuntime(schema);
