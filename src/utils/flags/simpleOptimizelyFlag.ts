import { flag } from "flags/next";
import {
  createBatchEventProcessor,
  createInstance,
  createOdpManager,
  createPollingProjectConfigManager,
  NOTIFICATION_TYPES,
  OptimizelyDecision,
  UserAttributes,
} from "@optimizely/optimizely-sdk";

const SDK_KEY = "KMikEY9xNzWLBhN119GUz";

const pollingConfigManager = createPollingProjectConfigManager({
  sdkKey: SDK_KEY,
  updateInterval: 10000, // poll for updates every 10 seconds for testing purposes
  autoUpdate: true,
});

const batchEventProcessor = createBatchEventProcessor();
const odpManager = createOdpManager();

async function optimizelyDecide(
  userId: string,
  flagKey: string,
  attributes?: UserAttributes
) {
  console.log("optimizelyDecide called", { userId, flagKey });

  const optimizely = createInstance({
    projectConfigManager: pollingConfigManager,
    eventProcessor: batchEventProcessor,
    odpManager: odpManager,
  });

  optimizely.notificationCenter.addNotificationListener(
    NOTIFICATION_TYPES.OPTIMIZELY_CONFIG_UPDATE,
    () => {
      console.log("Optimizely datafile loaded or updated");
    }
  );

  try {
    await optimizely.onReady();
    const user = optimizely.createUserContext(userId, attributes);

    const decision = user.decide(flagKey);
    const variationKey = decision.variationKey;

    if (variationKey === null) {
      console.log("decision error: ", decision["reasons"]);
    }

    if (decision.variationKey) {
      console.log("variation key: " + decision.variationKey);
    }

    // Return the full decision object so callers can inspect enabled, variationKey, reasons, etc.
    return decision;
  } catch (err: unknown) {
    console.error("onReady error:", err);
    return {
      enabled: false,
      reasons: ["onReady error"],
    };
  }
}

export type SimpleOptimizelyDecision = {
  variationKey: string | null;
  enabled: boolean;
  variables: {
    [variableKey: string]: unknown;
  };
  ruleKey: string | null;
  flagKey: string;
};

export const simpleOptimizelyFlag = flag<SimpleOptimizelyDecision>({
  key: "rollout_to_specific_audiences",
  identify({ cookies }) {
    const userId = cookies.get("sessionToken")?.value;
    return { user: { id: userId }, attr: { HasUserProductX: true } };
  },
  async decide({ entities }) {
    if (entities.user?.id == null) {
      return {
        enabled: false,
        variables: {},
        variationKey: null,
        ruleKey: null,
        flagKey: this.key,
      };
    }

    console.log("Deciding flag for user:", entities.user.id);
    console.log("With attributes:", entities.attr);

    const decision = await optimizelyDecide(
      entities.user?.id,
      this.key,
      entities.attr
    );

    if (!decision || !decision.enabled) {
      return {
        enabled: false,
        variationKey: null,
        variables: {},
        ruleKey: null,
        flagKey: this.key,
      };
    }

    return {
      variationKey: (decision as OptimizelyDecision).variationKey,
      enabled: (decision as OptimizelyDecision).enabled,
      variables: (decision as OptimizelyDecision).variables,
      ruleKey: (decision as OptimizelyDecision).ruleKey || null,
      flagKey: this.key,
    };
  },
});
