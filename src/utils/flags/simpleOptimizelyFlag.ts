import { flag } from "flags/next";
import { optimizelyAdapter } from "./optimizelyAdapter";
import type { UserAttributes } from "@optimizely/optimizely-sdk";

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
  // delegate evaluation to our custom Optimizely adapter
  adapter: optimizelyAdapter<
    SimpleOptimizelyDecision,
    { user?: { id?: string }; attr?: UserAttributes }
  >(),
});
