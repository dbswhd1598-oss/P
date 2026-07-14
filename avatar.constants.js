(function initFoodMileAvatarConstants(root) {
  "use strict";

  const constants = Object.freeze({
    AVATAR_STORAGE_KEY: "foodmile_avatar",
    AVATAR_CANVAS: Object.freeze({ width: 160, height: 192 }),
    AVATAR_PIVOT: Object.freeze({ x: 80, y: 192, anchor: "bottom-center" }),
    AVATAR_LAYER_ORDER: Object.freeze([
      Object.freeze({ slot: "backHair", dataKey: "hairBack", label: "BACK HAIR" }),
      Object.freeze({ slot: "body", dataKey: "body", label: "BODY" }),
      Object.freeze({ slot: "clothesBottom", dataKey: "bottom", label: "BOTTOM" }),
      Object.freeze({ slot: "shoes", dataKey: "shoes", label: "SHOES" }),
      Object.freeze({ slot: "clothesTop", dataKey: "top", label: "TOP" }),
      Object.freeze({ slot: "face", dataKey: "face", label: "FACE" }),
      Object.freeze({ slot: "eyes", dataKey: "eyes", label: "EYES" }),
      Object.freeze({ slot: "frontHair", dataKey: "hairFront", label: "FRONT HAIR" }),
      Object.freeze({ slot: "accessoryFront", dataKey: "accessory", label: "ACCESSORY" }),
    ]),
    AVATAR_ANIMATION_NAMES: Object.freeze(["idle", "walk", "sit", "wave"]),
    DEFAULT_AVATAR: Object.freeze({
      body: "body_starter",
      hairFront: "hair_front_starter",
      hairBack: "hair_back_starter",
      eyes: "eyes_starter",
      face: "face_starter",
      top: "top_starter",
      bottom: "bottom_starter",
      shoes: "shoes_starter",
      accessory: "accessory_none",
    }),
    PLACEHOLDER_ASSETS: Object.freeze({
      body: Object.freeze([
        Object.freeze({ id: "body_starter", placeholder: "BODY_PLACEHOLDER", tone: "coral" }),
        Object.freeze({ id: "body_warm", placeholder: "BODY_PLACEHOLDER", tone: "warm" }),
      ]),
      hairFront: Object.freeze([
        Object.freeze({ id: "hair_front_starter", placeholder: "HAIR_PLACEHOLDER", tone: "brown" }),
        Object.freeze({ id: "hair_front_soft", placeholder: "HAIR_PLACEHOLDER", tone: "peach" }),
      ]),
      hairBack: Object.freeze([
        Object.freeze({ id: "hair_back_starter", placeholder: "HAIR_PLACEHOLDER", tone: "brown" }),
        Object.freeze({ id: "hair_back_soft", placeholder: "HAIR_PLACEHOLDER", tone: "peach" }),
      ]),
      eyes: Object.freeze([Object.freeze({ id: "eyes_starter", placeholder: "EYES_PLACEHOLDER", tone: "brown" })]),
      face: Object.freeze([Object.freeze({ id: "face_starter", placeholder: "FACE_PLACEHOLDER", tone: "cream" })]),
      top: Object.freeze([
        Object.freeze({ id: "top_starter", placeholder: "TOP_PLACEHOLDER", tone: "coral" }),
        Object.freeze({ id: "top_cream", placeholder: "TOP_PLACEHOLDER", tone: "cream" }),
      ]),
      bottom: Object.freeze([
        Object.freeze({ id: "bottom_starter", placeholder: "BOTTOM_PLACEHOLDER", tone: "brown" }),
        Object.freeze({ id: "bottom_soft", placeholder: "BOTTOM_PLACEHOLDER", tone: "peach" }),
      ]),
      shoes: Object.freeze([
        Object.freeze({ id: "shoes_starter", placeholder: "SHOES_PLACEHOLDER", tone: "brown" }),
        Object.freeze({ id: "shoes_cream", placeholder: "SHOES_PLACEHOLDER", tone: "cream" }),
      ]),
      accessory: Object.freeze([Object.freeze({ id: "accessory_none", placeholder: "", tone: "none", hidden: true })]),
    }),
  });

  root.FoodMileAvatarConstants = constants;
  if (typeof module !== "undefined" && module.exports) module.exports = constants;
})(globalThis);
