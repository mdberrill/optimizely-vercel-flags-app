import type { Adapter, ReadonlyHeaders } from "flags";
import {
  Client,
  createBatchEventProcessor,
  createInstance,
  createPollingProjectConfigManager,
  eventDispatcher,
  EventDispatcher,
  EventDispatcherResponse,
  LogEvent,
  NOTIFICATION_TYPES,
  UserAttributes,
} from "@optimizely/optimizely-sdk";

export type OptimizelyAdapterOptions = {
  sdkKey: string;
  updateInterval?: number;
};

export type FlagsOptimizelyDecision = {
  variationKey: string | null;
  enabled: boolean;
  variables: Record<string, unknown>;
  ruleKey: string | null;
  flagKey: string;
};

export type OptimizelyAdapterEntities = {
  user: { id: string | null };
  attr?: UserAttributes;
};

export type ForcedDecisionInput = {
  flagKey?: string;
  ruleKey?: string | null;
  variationKey: string;
};

/*
 * Custom Event Dispatcher that logs events before dispatching them.
 * This could be used to send events to proxy
 */
export class CustomEventDispatcher implements EventDispatcher {
  private baseDispatcher: EventDispatcher;

  constructor() {
    this.baseDispatcher = eventDispatcher;
  }

  async dispatchEvent(event: LogEvent): Promise<EventDispatcherResponse> {
    // Custom behavior: Log the event
    console.log("[CustomEventDispatcher] Dispatching event:", {
      url: event.url,
      method: event.httpVerb,
      payload: event.params,
    });

    // Forward the event to the default dispatcher
    return this.baseDispatcher.dispatchEvent(event);
  }
}
/**
 * Parse the `x-decision-header` header to return an array of forced decision objects.
 */
function parseForcedDecisionsHeader(
  headers: ReadonlyHeaders
): ForcedDecisionInput[] {
  if (!headers) return [];

  const rawHeader = headers.get("x-decision-header");
  if (!rawHeader) return [];

  // rawHeader will be a json array, where each item is in the form of ForcedDecisionInput.
  // let's just parse it and hope it is valid.
  return JSON.parse(rawHeader) as ForcedDecisionInput[];
}

let optimizelyInstance: Client | null = null;
let optimizelyReadyPromise: Promise<unknown> | null = null;

/**
 * Vercel Flags SDK custom adapter for Optimizely.
 *
 * - Initializes and reuses a single Optimizely client instance so multiple
 *   flags can use this adapter without re-initialising the SDK.
 * - Supports forcing per-request decisions using the `x-decision-header` HTTP
 *   header (a JSON array of {@link ForcedDecisionInput}) applied to the created
 *   user context before calling `user.decide(key)`.
 *
 * @param {OptimizelyAdapterOptions} options - Adapter configuration.
 * @param {string} options.sdkKey - Optimizely SDK key (required).
 * @param {number} [options.updateInterval=10000] - Polling interval (ms) for project config updates.
 * @returns {Adapter<FlagsOptimizelyDecision, OptimizelyAdapterEntities>} An adapter compatible with the Vercel Flags SDK.
 *
 * Decide behaviour:
 * - `decide` requires `entities.user.id` and will throw an Error if missing.
 * - If the Optimizely SDK is not initialized or fails to become ready, `decide` will throw.
 */
export function optimizelyFlagsAdapter(
  options: OptimizelyAdapterOptions
): Adapter<FlagsOptimizelyDecision, OptimizelyAdapterEntities> {
  if (!options.sdkKey) {
    throw new Error("Optimizely Adapter: sdkKey is required");
  }

  if (!optimizelyInstance) {
    const updateInterval = options.updateInterval ?? 10000;

    const projectConfigManager = createPollingProjectConfigManager({
      sdkKey: options.sdkKey,
      updateInterval,
      autoUpdate: true,
    });

    const eventProcessor = createBatchEventProcessor({
      eventDispatcher: new CustomEventDispatcher(),
    });

    optimizelyInstance = createInstance({
      projectConfigManager,
      eventProcessor,
    });

    optimizelyInstance.notificationCenter.addNotificationListener(
      NOTIFICATION_TYPES.OPTIMIZELY_CONFIG_UPDATE,
      () => {
        if (process.env.NODE_ENV !== "production") {
          console.info("[Optimizely] Datafile loaded or updated");
        }
      }
    );

    optimizelyInstance.notificationCenter.addNotificationListener(
      NOTIFICATION_TYPES.LOG_EVENT,
      (LogEvent) => {
        if (process.env.NODE_ENV !== "production") {
          console.info("[Optimizely] Event logged:", LogEvent);
        }
      }
    );

    optimizelyInstance.notificationCenter.addNotificationListener(
      NOTIFICATION_TYPES.DECISION,
      (DecisionListenerPayload) => {
        if (process.env.NODE_ENV !== "production") {
          console.info("[Optimizely] Decision made:", DecisionListenerPayload);
        }
      }
    );
    optimizelyInstance.notificationCenter.addNotificationListener(
      NOTIFICATION_TYPES.TRACK,
      (TrackListenerPayload) => {
        if (process.env.NODE_ENV !== "production") {
          console.info("[Optimizely] Track made:", TrackListenerPayload);
        }
      }
    );
  }

  optimizelyReadyPromise = optimizelyInstance.onReady({ timeout: 5000 });

  return {
    async decide({ key, entities, headers }): Promise<FlagsOptimizelyDecision> {
      const typedEntities = entities as OptimizelyAdapterEntities;
      if (!typedEntities.user.id) {
        throw new Error(
          "Optimizely Adapter: entities with user id are required for decision"
        );
      }

      console.log("Decide with key:", key, "userId:", typedEntities.user.id);
      console.log("Decide with attributes:", typedEntities.attr);

      if (!optimizelyInstance || !optimizelyReadyPromise) {
        throw new Error("Optimizely SDK is not initialized");
      }

      await optimizelyReadyPromise;

      const user = optimizelyInstance.createUserContext(
        typedEntities.user.id,
        typedEntities.attr
      );

      // do any decisions need to be forced via the headers? e.g.
      // curl -v -H 'x-decision-header: [{"flagKey":"rollout_to_specific_audiences","variationKey":"on"}]' http://localhost:3000

      try {
        // For performance we could move this parsing logic to the proxy and use AsynclocalStorage to store this per-request data
        const forcedDecisions = parseForcedDecisionsHeader(headers);

        forcedDecisions
          .filter((forcedDecision) => forcedDecision.flagKey === key)
          .forEach((forcedDecision) => {
            user.setForcedDecision(
              { flagKey: key, ruleKey: forcedDecision.ruleKey ?? undefined },
              { variationKey: forcedDecision.variationKey }
            );
            console.log("[Optimizely] Set forced decision:", forcedDecision);
          });
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[Optimizely] Invalid x-decision-header:", err);
        }
      }

      const decision = user.decide(key);

      console.log("Optimizely decision enabled:", decision.enabled);
      console.log("Optimizely decision variationKey:", decision.variationKey);

      return {
        variationKey: decision.variationKey,
        enabled: decision.enabled,
        variables: decision.variables ?? {},
        ruleKey: decision.ruleKey ?? null,
        flagKey: key,
      };
    },
  };
}
