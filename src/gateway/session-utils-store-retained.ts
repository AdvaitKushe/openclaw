import { isDeepStrictEqual } from "node:util";
import { isPromiseLike } from "@openclaw/normalization-core/promise-like";
import type { CapturedSessionEntryReadSource } from "../config/sessions/session-accessor.types.js";
import { listSessionMembers } from "../config/sessions/session-sharing-store.js";
import type { SessionMember } from "../config/sessions/session-sharing-store.kernel.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { sessionChanges } from "../sessions/session-row-changes.js";
import type { GatewaySessionStoreTargetWithStore } from "./session-utils-store.types.js";

export function captureGatewaySessionReadSource(
  database: { agentId: string; path: string },
  identity: { identity: string; birthtime?: string } | undefined,
): CapturedSessionEntryReadSource | undefined {
  return identity
    ? {
        ...database,
        databaseIdentity: identity.identity,
        ...(identity.birthtime ? { databaseBirthtime: identity.birthtime } : {}),
      }
    : undefined;
}

/** Process-held incognito state cannot be reopened by the durable read worker. */
export function withIncognitoGatewaySessionStoreTarget<T>(params: {
  cfg: OpenClawConfig;
  key: string;
  agentId?: string;
  env?: NodeJS.ProcessEnv;
  projection?: "list" | "full";
  includeMembership?: boolean;
  identity: { agentId: string; canonicalKey: string };
  resolve: () => GatewaySessionStoreTargetWithStore;
  consume: (
    target: GatewaySessionStoreTargetWithStore,
    membership: ReadonlyMap<string, readonly SessionMember[]>,
    assertCurrent: () => void,
  ) => T;
}): T {
  let active = true;
  let changed = false;
  const stop = sessionChanges.subscribeFacts((change) => {
    if (
      "all" in change
        ? change.scope !== "runtime"
        : change.scope !== "runtime" &&
          change.sessionKey === params.identity.canonicalKey &&
          (!change.agentId || change.agentId === params.identity.agentId)
    ) {
      changed = true;
    }
  });
  try {
    const target = params.resolve();
    const membership = new Map<string, readonly SessionMember[]>(
      params.includeMembership
        ? target.storeKeys.map((sessionKey) => [
            sessionKey,
            listSessionMembers({
              agentId: target.agentId,
              storePath: target.storePath,
              sessionKey,
            }),
          ])
        : [],
    );
    const assertCurrent = () => {
      if (!active || changed || !isDeepStrictEqual(params.resolve(), target)) {
        throw new Error("Incognito session source changed during consumption");
      }
    };
    const result = params.consume(target, membership, assertCurrent);
    if (isPromiseLike(result)) {
      throw new Error("Session entry consumers must remain synchronous");
    }
    return result;
  } finally {
    active = false;
    stop();
  }
}
