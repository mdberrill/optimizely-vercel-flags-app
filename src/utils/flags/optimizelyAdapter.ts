import type { Adapter } from "flags";
import {
  Client,
  createBatchEventProcessor,
  createInstance,
  createPollingProjectConfigManager,
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

let optimizelyInstance: Client | null = null;
let optimizelyReadyPromise: Promise<unknown> | null = null;

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

    const eventProcessor = createBatchEventProcessor();

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
  }

  optimizelyReadyPromise = optimizelyInstance.onReady({ timeout: 5000 });

  return {
    async decide({ key, entities }): Promise<FlagsOptimizelyDecision> {
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
