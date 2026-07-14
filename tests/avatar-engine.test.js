"use strict";

const assert = require("node:assert/strict");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

global.location = { hostname: "localhost" };
global.localStorage = memoryStorage();
global.FoodMileAvatarConstants = require("../avatar.constants.js");
const Avatar = require("../avatar-engine.js");

assert.deepEqual(
  Avatar.getLayerOrder().map((layer) => layer.slot),
  ["backHair", "body", "clothesBottom", "shoes", "clothesTop", "face", "eyes", "frontHair", "accessoryFront"],
);
assert.deepEqual(Avatar.getCanvasSpec(), {
  width: 160,
  height: 192,
  pivot: { x: 80, y: 192, anchor: "bottom-center" },
});
assert.deepEqual(Avatar.getAnimationNames(), ["idle", "walk", "sit", "wave"]);
assert.deepEqual(Avatar.loadAvatar(), global.FoodMileAvatarConstants.DEFAULT_AVATAR);

Avatar.setHair("hair_front_soft", "hair_back_soft");
Avatar.setTop("top_cream");
Avatar.setShoes("shoes_cream");
const equipped = Avatar.loadAvatar();
assert.equal(equipped.hairFront, "hair_front_soft");
assert.equal(equipped.hairBack, "hair_back_soft");
assert.equal(equipped.top, "top_cream");
assert.equal(equipped.shoes, "shoes_cream");
assert.deepEqual(JSON.parse(global.localStorage.getItem("foodmile_avatar")), equipped);

const restoredStorage = memoryStorage({ foodmile_avatar: JSON.stringify(equipped) });
assert.deepEqual(Avatar.loadAvatar(restoredStorage), equipped);
assert.equal(Avatar.registerAsset("top", { id: "top_future_png", src: "/assets/avatar/top.png" }), true);
assert.equal(Avatar.registerAsset("top", { id: "wrong_size", width: 320, height: 384 }), false);
assert.equal(Avatar.registerAsset("unknown", { id: "invalid" }), false);
assert.equal(Avatar.isDevelopmentMode(), true);

const damagedStorage = memoryStorage({ foodmile_avatar: "{bad-json" });
assert.doesNotThrow(() => Avatar.loadAvatar(damagedStorage));
assert.deepEqual(Avatar.loadAvatar(damagedStorage), global.FoodMileAvatarConstants.DEFAULT_AVATAR);

console.log("avatar-engine.test.js: layer order, canvas, pivot, setters, persistence and recovery checks passed");
