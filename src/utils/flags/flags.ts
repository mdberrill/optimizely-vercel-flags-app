import { flag } from "flags/next";

/**
 * Demo feature flag that toggles the homepage heading order.
 * Set `decide()` to `true` to show the new text by default for demo purposes.
 */
export const reorderHomeHeading = flag<boolean>({
  key: "reorder-homepage-heading",
  decide() {
    return false;
  },
});
