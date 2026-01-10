import type { Adapter } from "flags";
import {
  createBatchEventProcessor,
  createInstance,
  createOdpManager,
  createPollingProjectConfigManager,
  NOTIFICATION_TYPES,
  UserAttributes,
} from "@optimizely/optimizely-sdk";

export type OptimizelyAdapterOptions = {
  sdkKey?: string;
  updateInterval?: number;
};

/**
 * Factory that creates an Optimizely adapter compatible with the Vercel Flags SDK.
 *
 * Example usage:
 *   adapter: optimizelyAdapter<MyFlagValue, { user?: { id?: string }, attr?: UserAttributes }>()
 *
 * Notes:
 * - `ValueType` should match the shape returned by `decide`.
 * - `EntitiesType` can include a `user` object with `id`, and optional `attr` matching `UserAttributes`.
 */
export function createOptimizelyAdapter(
  options: OptimizelyAdapterOptions = {}
) {
  const SDK_KEY = "KMikEY9xNzWLBhN119GUz";
  const sdkKey = options.sdkKey ?? process.env.OPTIMIZELY_SDK_KEY ?? SDK_KEY;
  const updateInterval = options.updateInterval ?? 10000;

  if (
    sdkKey === SDK_KEY &&
    !options.sdkKey &&
    !process.env.OPTIMIZELY_SDK_KEY
  ) {
    console.warn(
      "Optimizely Adapter: Using hard-coded fallback SDK key for development/testing"
    );
  }

  // Shared instances for polling/config & events
  const pollingConfigManager = createPollingProjectConfigManager({
    sdkKey,
    updateInterval,
    autoUpdate: true,
  });

  const batchEventProcessor = createBatchEventProcessor();
  const odpManager = createOdpManager();

  const optimizely = createInstance({
    projectConfigManager: pollingConfigManager,
    eventProcessor: batchEventProcessor,
    odpManager,
  });

  optimizely.notificationCenter.addNotificationListener(
    NOTIFICATION_TYPES.OPTIMIZELY_CONFIG_UPDATE,
    () => {
      // Helpful for debugging when running locally
      console.log("Optimizely datafile loaded or updated");
    }
  );

  return function optimizelyAdapter<
    ValueType,
    EntitiesType extends Record<string, unknown> = Record<string, unknown>
  >(): Adapter<ValueType, EntitiesType> {
    return {
      async decide({ key, entities }): Promise<ValueType> {
        type EntitiesLike = {
          user?: { id?: string | null };
          attr?: UserAttributes | undefined;
        };

        const typedEntities = entities as unknown as EntitiesLike | undefined;
        const userId = typedEntities?.user?.id;
        const attrs = typedEntities?.attr;

        console.log("Decide called with key:", key, "userId:", userId);
        console.log("Decide called with attributes:", attrs);

        // If we don't have an ID, return a disabled/empty value that matches
        // the shape expected by consumers. We can't know ValueType generically,
        // so users should prefer a typed ValueType that this adapter returns.
        if (!userId) {
          const disabledValue = {
            variationKey: null,
            enabled: false,
            variables: {},
            ruleKey: null,
            flagKey: key,
          } as unknown as ValueType;

          return disabledValue;
        }

        await optimizely.onReady();

        const user = optimizely.createUserContext(userId, attrs);

        const decision = user.decide(key);
        console.log("Optimizely decision enabled:", decision.enabled);
        console.log("Optimizely decision variationKey:", decision.variationKey);

        if (!decision || !decision.enabled) {
          return {
            variationKey: null,
            enabled: false,
            variables: {},
            ruleKey: null,
            flagKey: key,
          } as unknown as ValueType;
        }

        // Map the Optimizely decision shape into a predictable object.
        // Consumers should type `ValueType` to match this shape (see examples).
        return {
          variationKey: decision.variationKey,
          enabled: decision.enabled,
          variables: decision.variables ?? {},
          ruleKey: decision.ruleKey ?? null,
          flagKey: key,
        } as unknown as ValueType;
      },
    };
  };
}

// Default lazy adapter that reads SDK key from OPTIMIZELY_SDK_KEY
export function optimizelyAdapter<
  ValueType,
  EntitiesType extends Record<string, unknown> = Record<string, unknown>
>() {
  let innerAdapter: Adapter<ValueType, EntitiesType> | undefined;

  const ensureAdapter = () => {
    if (!innerAdapter) {
      const sdkKey = process.env.OPTIMIZELY_SDK_KEY;
      innerAdapter = createOptimizelyAdapter({ sdkKey })() as Adapter<
        /* generic */
        ValueType,
        EntitiesType
      >;
    }
  };

  return {
    async decide(ctx) {
      ensureAdapter();
      if (!innerAdapter) {
        throw new Error("Optimizely Adapter is not configured.");
      }
      return innerAdapter.decide(ctx);
    },
  } as Adapter<ValueType, EntitiesType>;
}
