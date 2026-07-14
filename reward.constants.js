(function initFoodMileRewardConstants(root) {
  "use strict";

  const constants = Object.freeze({
    REWARD_PROFILE_STORAGE_KEY: "foodmile_reward_profile",
    LEGACY_POINTS_STORAGE_KEY: "foodmile_demo_points",
    VISIT_REWARD_POINTS: 20,
    VISIT_REWARD_EXP: 10,
    MAX_RECENT_REWARDS: 5,
    MAX_RECENT_ACTIVITY: 10,
    LEVEL_EXP_REQUIREMENTS: Object.freeze({
      1: 50,
      2: 100,
      3: 160,
      4: 240,
    }),
    REWARD_CATALOG: Object.freeze([
      Object.freeze({ id: "reward_starter_wallpaper", type: "wallpaper", name: "스타터 벽지", unlockLevel: 2, assetStatus: "placeholder" }),
      Object.freeze({ id: "reward_basic_plant", type: "furniture", name: "기본 화분", unlockLevel: 3, assetStatus: "placeholder" }),
      Object.freeze({ id: "reward_cream_top", type: "avatar", name: "크림색 상의", unlockLevel: 4, assetStatus: "placeholder" }),
      Object.freeze({ id: "reward_spring_background", type: "background", name: "봄날 배경", unlockLevel: 5, assetStatus: "placeholder" }),
    ]),
  });

  root.FoodMileRewardConstants = constants;
  if (typeof module !== "undefined" && module.exports) module.exports = constants;
})(globalThis);
