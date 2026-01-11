import { flag } from "flags/next";
import { optimizelyFlagsAdapter } from "./optimizelyAdapter";
import type {
  FlagsOptimizelyDecision,
  OptimizelyAdapterEntities,
} from "./optimizelyAdapter";

export const simpleOptimizelyFlag = flag<FlagsOptimizelyDecision>({
  key: "rollout_to_specific_audiences",
  identify({ cookies }) {
    const userId = cookies.get("sessionToken")?.value;
    const userEntites = {
      user: { id: userId },
      attr: { HasUserProductX: true },
    } as OptimizelyAdapterEntities;
    return userEntites;
  },

  adapter: optimizelyFlagsAdapter({
    sdkKey: "KMikEY9xNzWLBhN119GUz",
  }),
});
