(function initFoodMileRewards(root) {
  "use strict";

  const C = root.FoodMileRewardConstants;
  if (!C) throw new Error("FoodMileRewardConstants must load before reward-engine.js");

  function localDateKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dayNumber(dateKey) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  }

  function experienceRequired(level) {
    const listed = C.LEVEL_EXP_REQUIREMENTS[level];
    if (listed) return listed;
    const extraLevels = Math.max(0, level - 5);
    return 320 + extraLevels * 100;
  }

  function defaultProfile(legacyPoints = 0) {
    return {
      points: Number.isFinite(legacyPoints) && legacyPoints > 0 ? Math.floor(legacyPoints) : 0,
      experience: 0,
      level: 1,
      visitCount: 0,
      streakDays: 0,
      lastVisitDate: null,
      unlockedRewards: [],
      recentRewards: [],
      processedVerificationIds: [],
    };
  }

  function sanitizeProfile(value, legacyPoints = 0) {
    const base = defaultProfile(legacyPoints);
    if (!value || typeof value !== "object" || Array.isArray(value)) return base;
    const number = (candidate, fallback, minimum = 0) => {
      const parsed = Number(candidate);
      return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
    };
    return {
      points: number(value.points, base.points),
      experience: number(value.experience, 0),
      level: number(value.level, 1, 1),
      visitCount: number(value.visitCount, 0),
      streakDays: number(value.streakDays, 0),
      lastVisitDate: /^\d{4}-\d{2}-\d{2}$/.test(value.lastVisitDate || "") ? value.lastVisitDate : null,
      unlockedRewards: Array.isArray(value.unlockedRewards) ? [...new Set(value.unlockedRewards.filter((id) => typeof id === "string"))] : [],
      recentRewards: Array.isArray(value.recentRewards) ? value.recentRewards.filter((item) => item && typeof item.id === "string").slice(0, C.MAX_RECENT_REWARDS) : [],
      processedVerificationIds: Array.isArray(value.processedVerificationIds) ? [...new Set(value.processedVerificationIds.filter((id) => typeof id === "string"))].slice(-200) : [],
    };
  }

  function readProfile(storage = root.localStorage) {
    const legacyPoints = Number(storage?.getItem(C.LEGACY_POINTS_STORAGE_KEY) || 0);
    const raw = storage?.getItem(C.REWARD_PROFILE_STORAGE_KEY);
    if (!raw) return defaultProfile(legacyPoints);
    try {
      return sanitizeProfile(JSON.parse(raw), legacyPoints);
    } catch (error) {
      console.warn("FoodMile reward profile was damaged and has been reset.", error);
      return defaultProfile(legacyPoints);
    }
  }

  function saveProfile(profile, storage = root.localStorage) {
    const safeProfile = sanitizeProfile(profile);
    storage?.setItem(C.REWARD_PROFILE_STORAGE_KEY, JSON.stringify(safeProfile));
    storage?.setItem(C.LEGACY_POINTS_STORAGE_KEY, String(safeProfile.points));
    return safeProfile;
  }

  function calculateStreak(previousDate, previousStreak, verifiedAt) {
    const currentDate = localDateKey(verifiedAt);
    if (!previousDate) return { streakDays: 1, lastVisitDate: currentDate };
    if (previousDate === currentDate) return { streakDays: Math.max(1, previousStreak), lastVisitDate: currentDate };
    const difference = dayNumber(currentDate) - dayNumber(previousDate);
    return {
      streakDays: difference === 1 ? Math.max(1, previousStreak) + 1 : 1,
      lastVisitDate: currentDate,
    };
  }

  function applyExperience(level, experience, amount) {
    let nextLevel = Math.max(1, level);
    let nextExperience = Math.max(0, experience) + Math.max(0, amount);
    const levelsGained = [];
    while (nextExperience >= experienceRequired(nextLevel)) {
      nextExperience -= experienceRequired(nextLevel);
      nextLevel += 1;
      levelsGained.push(nextLevel);
    }
    return { level: nextLevel, experience: nextExperience, levelsGained };
  }

  function rewardsForLevel(level) {
    return C.REWARD_CATALOG.filter((reward) => reward.unlockLevel <= level);
  }

  function makeVerificationId(storeId, verifiedAt) {
    return `${storeId}:${localDateKey(verifiedAt)}:${verifiedAt}`;
  }

  function applyVisitReward(input, storage = root.localStorage) {
    const verifiedAt = Number(input?.verifiedAt || Date.now());
    const verificationId = String(input?.verificationId || makeVerificationId(input?.storeId || "store", verifiedAt));
    const before = readProfile(storage);
    if (before.processedVerificationIds.includes(verificationId)) {
      return { applied: false, duplicate: true, verificationId, before, profile: before, newlyUnlocked: [], levelsGained: [] };
    }

    const experienceResult = applyExperience(before.level, before.experience, C.VISIT_REWARD_EXP);
    const streak = calculateStreak(before.lastVisitDate, before.streakDays, verifiedAt);
    const eligible = rewardsForLevel(experienceResult.level);
    const newlyUnlocked = eligible.filter((reward) => !before.unlockedRewards.includes(reward.id));
    const unlockedRewards = [...before.unlockedRewards, ...newlyUnlocked.map((reward) => reward.id)];
    const recentRewards = [
      ...newlyUnlocked.map((reward) => ({ ...reward, unlockedAt: verifiedAt })),
      ...before.recentRewards,
    ].slice(0, C.MAX_RECENT_REWARDS);

    const profile = saveProfile({
      ...before,
      points: before.points + C.VISIT_REWARD_POINTS,
      experience: experienceResult.experience,
      level: experienceResult.level,
      visitCount: before.visitCount + 1,
      streakDays: streak.streakDays,
      lastVisitDate: streak.lastVisitDate,
      unlockedRewards,
      recentRewards,
      processedVerificationIds: [...before.processedVerificationIds, verificationId].slice(-200),
    }, storage);

    return {
      applied: true,
      duplicate: false,
      verificationId,
      before,
      profile,
      newlyUnlocked,
      levelsGained: experienceResult.levelsGained,
      pointsAwarded: C.VISIT_REWARD_POINTS,
      experienceAwarded: C.VISIT_REWARD_EXP,
      currentRequirement: experienceRequired(profile.level),
    };
  }

  const api = Object.freeze({
    readProfile,
    saveProfile,
    defaultProfile,
    sanitizeProfile,
    experienceRequired,
    applyExperience,
    calculateStreak,
    applyVisitReward,
    makeVerificationId,
    rewardsForLevel,
    localDateKey,
  });
  root.FoodMileRewards = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
