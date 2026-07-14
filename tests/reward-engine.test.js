"use strict";

const assert = require("node:assert/strict");
global.FoodMileRewardConstants = require("../reward.constants.js");
const Rewards = require("../reward-engine.js");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function at(year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour).getTime();
}

assert.deepEqual(Rewards.applyExperience(1, 0, 10), { level: 1, experience: 10, levelsGained: [] });
assert.deepEqual(Rewards.applyExperience(1, 45, 10), { level: 2, experience: 5, levelsGained: [2] });
assert.deepEqual(Rewards.applyExperience(2, 95, 170), { level: 4, experience: 5, levelsGained: [3, 4] });
assert.equal(Rewards.experienceRequired(1), 50);
assert.equal(Rewards.experienceRequired(4), 240);
assert.equal(Rewards.experienceRequired(6), 420);

const firstStorage = memoryStorage();
const first = Rewards.applyVisitReward({ verificationId: "first", storeId: "store-a", verifiedAt: at(2026, 7, 14) }, firstStorage);
assert.equal(first.applied, true);
assert.equal(first.profile.points, 20);
assert.equal(first.profile.experience, 10);
assert.equal(first.profile.visitCount, 1);
assert.equal(first.profile.streakDays, 1);

const duplicate = Rewards.applyVisitReward({ verificationId: "first", storeId: "store-a", verifiedAt: at(2026, 7, 14) }, firstStorage);
assert.equal(duplicate.applied, false);
assert.equal(duplicate.profile.points, 20);
assert.equal(duplicate.profile.experience, 10);

const levelStorage = memoryStorage({
  foodmile_reward_profile: JSON.stringify({
    ...Rewards.defaultProfile(), level: 1, experience: 45,
  }),
});
const levelUp = Rewards.applyVisitReward({ verificationId: "level-up", storeId: "store-b", verifiedAt: at(2026, 7, 14) }, levelStorage);
assert.equal(levelUp.profile.level, 2);
assert.equal(levelUp.profile.experience, 5);
assert.deepEqual(levelUp.newlyUnlocked.map((reward) => reward.id), ["reward_starter_wallpaper"]);

const nextVisit = Rewards.applyVisitReward({ verificationId: "after-level", storeId: "store-c", verifiedAt: at(2026, 7, 15) }, levelStorage);
assert.equal(nextVisit.newlyUnlocked.length, 0);
assert.equal(nextVisit.profile.unlockedRewards.filter((id) => id === "reward_starter_wallpaper").length, 1);
assert.equal(nextVisit.profile.streakDays, 2);

const sameDay = Rewards.calculateStreak("2026-07-15", 2, at(2026, 7, 15, 20));
assert.equal(sameDay.streakDays, 2);
const nextDay = Rewards.calculateStreak("2026-07-15", 2, at(2026, 7, 16));
assert.equal(nextDay.streakDays, 3);
const skippedDay = Rewards.calculateStreak("2026-07-15", 4, at(2026, 7, 17));
assert.equal(skippedDay.streakDays, 1);

const legacyStorage = memoryStorage({ foodmile_demo_points: "120" });
assert.equal(Rewards.readProfile(legacyStorage).points, 120);
const damagedStorage = memoryStorage({ foodmile_reward_profile: "{not-json", foodmile_demo_points: "40" });
assert.doesNotThrow(() => Rewards.readProfile(damagedStorage));
assert.equal(Rewards.readProfile(damagedStorage).points, 40);

console.log("reward-engine.test.js: all reward, level, streak, migration, corruption and duplicate checks passed");
