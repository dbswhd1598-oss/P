(function initFoodMileRewardUI(root) {
  "use strict";

  const Rewards = root.FoodMileRewards;
  const C = root.FoodMileRewardConstants;
  if (!Rewards || !C) throw new Error("Reward engine must load before reward-ui.js");

  let resultRoot = null;
  let minihomeRoot = null;
  let inventoryRoot = null;
  let resultTrigger = null;
  let inventoryTrigger = null;
  let activeInventoryFilter = "all";

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  function typeLabel(type) {
    return ({ avatar: "아바타", furniture: "가구", wallpaper: "배경", background: "배경" })[type] || "아이템";
  }

  function setActiveNavigation(target) {
    document.querySelectorAll(".bottom-nav-item").forEach((button) => {
      const isCurrent = button.dataset.navTarget === target;
      button.classList.toggle("is-active", isCurrent);
      if (isCurrent) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function progressMarkup(profile, className = "", animated = true) {
    const required = Rewards.experienceRequired(profile.level);
    const percent = Math.min(100, (profile.experience / required) * 100);
    return `
      <section class="reward-progress ${className}" aria-label="레벨 ${profile.level} 경험치 진행도">
        <div class="reward-progress-heading"><strong>LV.${profile.level}</strong><span>${profile.experience} / ${required} EXP</span></div>
        <div class="reward-progress-track" role="progressbar" aria-label="다음 레벨 경험치" aria-valuemin="0" aria-valuemax="${required}" aria-valuenow="${profile.experience}">
          <span class="reward-progress-fill" data-progress-target="${percent.toFixed(2)}"${animated ? "" : ` style="width:${percent.toFixed(2)}%"`}></span>
        </div>
        <small>다음 레벨까지 ${Math.max(0, required - profile.experience)} EXP</small>
      </section>`;
  }

  function animateProgress(container, startPercent = 0) {
    const fill = container?.querySelector(".reward-progress-fill");
    if (!fill) return;
    fill.style.width = `${Math.max(0, Math.min(100, startPercent))}%`;
    root.requestAnimationFrame(() => root.requestAnimationFrame(() => {
      fill.style.width = `${fill.dataset.progressTarget}%`;
    }));
  }

  function closeResult(options = {}) {
    resultRoot?.remove();
    resultRoot = null;
    document.body.classList.remove("reward-result-open");
    if (options.restoreFocus !== false) resultTrigger?.focus();
    resultTrigger = null;
  }

  function showRewardResult(result, options = {}) {
    if (!result?.applied) return false;
    closeResult({ restoreFocus: false });
    resultTrigger = options.trigger || document.activeElement;
    const leveledUp = result.levelsGained.length > 0;
    const previousRequirement = Rewards.experienceRequired(result.before.level);
    const previousPercent = leveledUp ? 0 : (result.before.experience / previousRequirement) * 100;
    const rewardCards = result.newlyUnlocked.map((reward) => `
      <article class="reward-unlock-card">
        <span class="reward-placeholder" aria-hidden="true">${reward.type === "avatar" ? "AVATAR" : "ROOM"}</span>
        <div><strong>${escapeHtml(reward.name)}</strong><small>${typeLabel(reward.type)} · 준비 중</small></div>
        <span>미니홈에서 확인</span>
      </article>`).join("");

    resultRoot = document.createElement("div");
    resultRoot.className = "reward-result-root";
    resultRoot.innerHTML = `
      <div class="reward-result-backdrop">
        <section class="reward-result-card${leveledUp ? " is-level-up" : ""}" role="dialog" aria-modal="true" aria-labelledby="reward-result-title">
          <span class="reward-check" aria-hidden="true">✓</span>
          ${leveledUp ? '<p class="reward-level-up" aria-live="polite">LEVEL UP!</p>' : ""}
          <h2 id="reward-result-title" role="status">방문 인증 완료!</h2>
          <div class="reward-gains" aria-label="획득한 데모 보상">
            <strong>+${result.pointsAwarded}P <small>데모 포인트</small></strong>
            <strong>+${result.experienceAwarded} EXP</strong>
          </div>
          ${progressMarkup(result.profile, "reward-result-progress")}
          <p class="reward-visit-total">누적 방문 인증 <strong>${result.profile.visitCount}회</strong></p>
          <p class="reward-streak">${result.profile.streakDays}일 연속 푸드마일 중</p>
          ${rewardCards ? `<section class="reward-unlocked"><h3>새로운 아이템을 획득했어요!</h3>${rewardCards}</section>` : ""}
          <div class="reward-result-actions">
            <button type="button" class="reward-secondary" data-reward-action="continue-map">지도 계속 보기</button>
            <button type="button" class="reward-primary" data-reward-action="go-minihome">미니홈 가기</button>
          </div>
          <p class="reward-demo-note">프론트엔드 데모 보상이며 실제 결제성 자산이 아닙니다.</p>
        </section>
      </div>`;
    document.body.append(resultRoot);
    document.body.classList.add("reward-result-open");
    animateProgress(resultRoot, previousPercent);
    resultRoot.querySelector("[data-reward-action='go-minihome']")?.focus();

    resultRoot.addEventListener("click", (event) => {
      const action = event.target.closest("[data-reward-action]")?.dataset.rewardAction;
      if (action === "continue-map") {
        closeResult();
        options.onContinueMap?.();
      }
      if (action === "go-minihome") {
        closeResult({ restoreFocus: false });
        openMinihome();
        options.onOpenMinihome?.();
      }
    });
    return true;
  }

  function minihomeStats(profile) {
    let records = [];
    try {
      const parsed = JSON.parse(root.localStorage.getItem("foodmile_visit_verifications") || "[]");
      records = Array.isArray(parsed) ? parsed.filter((record) => record && record.storeId) : [];
    } catch {
      records = [];
    }
    const today = Rewards.localDateKey(Date.now());
    return {
      todayVisits: records.filter((record) => Rewards.localDateKey(Number(record.verifiedAt)) === today).length,
      uniqueStores: Math.max(profile.visitedStoreIds.length, new Set(records.map((record) => record.storeId)).size),
    };
  }

  function activityDate(timestamp) {
    if (!Number.isFinite(Number(timestamp))) return "날짜 준비중";
    return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(timestamp));
  }

  function activityIso(timestamp) {
    const value = Number(timestamp);
    return Number.isFinite(value) ? new Date(value).toISOString() : "";
  }

  function activityMarkup(profile) {
    if (!profile.recentActivity.length) {
      return '<p class="minihome-empty-activity">첫 방문 인증을 기다리고 있어요.</p>';
    }
    const icons = { visit: "✓", level: "LV", reward: "□", record: "＋" };
    return profile.recentActivity.slice(0, 10).map((activity) => `
      <article class="minihome-activity-item">
        <span class="minihome-activity-icon" aria-hidden="true">${icons[activity.type] || "·"}</span>
        <div><strong>${escapeHtml(activity.title)}</strong><p>${escapeHtml(activity.detail)}</p></div>
        <time datetime="${activityIso(activity.occurredAt)}">${activityDate(activity.occurredAt)}</time>
      </article>`).join("");
  }

  function dashboardMarkup(profile) {
    const recent = profile.recentRewards[0];
    const stats = minihomeStats(profile);
    return `
      <header class="minihome-header">
        <div><small>FOODMILE</small><h1>FoodMile Minihome</h1></div>
        <nav class="minihome-header-actions" aria-label="미니홈 빠른 메뉴">
          <button type="button" aria-label="미니홈 설정">⚙</button>
          <button type="button" aria-label="미니홈 공유">↗</button>
          <button type="button" aria-label="미니홈 알림">●</button>
        </nav>
      </header>
      <main class="minihome-content">
        <section class="minihome-profile-card" aria-label="프로필 요약">
          <div class="minihome-profile-photo" aria-label="프로필 사진 Placeholder">PROFILE</div>
          <div class="minihome-profile-main">
            <div class="minihome-profile-title"><div><small>FoodMile User</small><h2>푸드마일러</h2></div><span>LV.${profile.level}</span></div>
            ${progressMarkup(profile, "minihome-profile-progress", false)}
          </div>
          <div class="minihome-profile-stats">
            <div><span>방문 인증</span><strong>${profile.visitCount}회</strong></div>
            <div><span>연속 인증</span><strong>${profile.streakDays}일</strong></div>
            <div><span>보유 Point</span><strong>${profile.points.toLocaleString()}P</strong><small>데모</small></div>
          </div>
          <button type="button" class="minihome-edit-profile" disabled aria-label="프로필 편집 준비 중">프로필 편집 <small>준비 중</small></button>
        </section>
        <nav class="minihome-section-tabs" aria-label="미니홈 메뉴">
          <button type="button" class="is-active" aria-current="page">Room</button>
          <button type="button" disabled>Reward <small>Coming Soon</small></button>
          <button type="button" disabled>Activity <small>Coming Soon</small></button>
          <button type="button" disabled>Info <small>Coming Soon</small></button>
        </nav>
        <section class="minihome-room-card" aria-label="Minihome Room Placeholder">
          <header><div><small>MY LITTLE SPACE</small><h2>Minihome Room</h2></div><span>Structure Only</span></header>
          <div class="minihome-room-stage">
            <div class="wall-placeholder"><span>WALL PLACEHOLDER</span></div>
            <div class="floor-placeholder"><span>FLOOR PLACEHOLDER</span></div>
            <div class="room-placeholder"><span>ROOM PLACEHOLDER</span></div>
            <div class="avatar-placeholder"><span>AVATAR<br />PLACEHOLDER</span></div>
          </div>
          <p>방과 아바타 구조만 준비되어 있어요.</p>
        </section>
        <section class="minihome-today-card" aria-label="TODAY 방문 요약">
          <header><div><small>FOODMILE LOG</small><h2>TODAY</h2></div><strong>${stats.todayVisits}</strong></header>
          <div class="minihome-today-grid">
            <div><span>Total Visit</span><strong>${profile.visitCount}</strong></div>
            <div><span>최근 인증 날짜</span><strong>${profile.lastVisitDate || "아직 없음"}</strong></div>
            <div><span>방문한 식당 수</span><strong>${stats.uniqueStores}곳</strong></div>
          </div>
        </section>
        <section class="minihome-activity-card" aria-label="최근 활동">
          <header><div><small>RECENT LOG</small><h2>Recent Activity</h2></div><span>최근 ${Math.min(10, profile.recentActivity.length)}개</span></header>
          <div class="minihome-activity-list">${activityMarkup(profile)}</div>
        </section>
        <section class="minihome-reward-summary" aria-label="보상 요약">
          <header><div><small>MY REWARD</small><h2>Reward Summary</h2></div><span>${profile.unlockedRewards.length} unlocked</span></header>
          <div class="minihome-reward-grid">
            <div class="minihome-reward-placeholder" aria-hidden="true">REWARD<br />PLACEHOLDER</div>
            <div class="minihome-reward-recent"><span>최근 획득</span><strong>${recent ? escapeHtml(recent.name) : "아직 없어요"}</strong><small>${recent ? `${typeLabel(recent.type)} · Placeholder` : "방문 인증으로 보상을 모아보세요"}</small></div>
          </div>
          ${progressMarkup(profile, "minihome-reward-progress", false)}
        </section>
      </main>`;
  }

  function openMinihome() {
    closeInventory({ restoreFocus: false });
    if (!minihomeRoot) {
      minihomeRoot = document.createElement("section");
      minihomeRoot.className = "minihome-screen";
      minihomeRoot.setAttribute("aria-label", "미니홈 성장 대시보드");
      document.body.append(minihomeRoot);
      minihomeRoot.addEventListener("click", (event) => {
        const action = event.target.closest("[data-minihome-action]")?.dataset.minihomeAction;
        if (action === "map") closeMinihome();
      });
    }
    minihomeRoot.innerHTML = dashboardMarkup(Rewards.readProfile());
    minihomeRoot.classList.add("is-open");
    document.body.classList.add("minihome-open");
    setActiveNavigation("minihome");
    minihomeRoot.querySelector(".minihome-header h1")?.setAttribute("tabindex", "-1");
    minihomeRoot.querySelector(".minihome-header h1")?.focus();
  }

  function closeMinihome() {
    closeInventory({ restoreFocus: false });
    minihomeRoot?.classList.remove("is-open");
    document.body.classList.remove("minihome-open");
    setActiveNavigation("map");
    document.querySelector('[data-nav-target="map"]')?.focus();
  }

  function inventoryItemsMarkup(profile, filter) {
    const items = C.REWARD_CATALOG.filter((reward) => {
      if (filter === "all") return true;
      if (filter === "background") return ["wallpaper", "background"].includes(reward.type);
      return reward.type === filter;
    });
    return items.map((reward) => {
      const unlocked = profile.unlockedRewards.includes(reward.id);
      return `
        <article class="inventory-item${unlocked ? " is-unlocked" : " is-locked"}">
          <span class="inventory-placeholder" aria-hidden="true">${reward.type === "avatar" ? "AVATAR" : "ITEM"}</span>
          <div><strong>${escapeHtml(reward.name)}</strong><span>${typeLabel(reward.type)} · LV.${reward.unlockLevel} 달성</span><small>${unlocked ? "획득 완료 · 준비 중" : `잠김 · LV.${reward.unlockLevel} 필요`}</small></div>
        </article>`;
    }).join("");
  }

  function renderInventory() {
    if (!inventoryRoot) return;
    const profile = Rewards.readProfile();
    const filters = [["all", "전체"], ["avatar", "아바타"], ["furniture", "가구"], ["background", "배경"]];
    inventoryRoot.innerHTML = `
      <div class="inventory-backdrop" data-inventory-dismiss="true">
        <section class="inventory-sheet" role="dialog" aria-modal="true" aria-labelledby="inventory-title">
          <div class="inventory-handle" aria-hidden="true"></div>
          <header><div><small>MY REWARDS</small><h2 id="inventory-title">보상함</h2></div><button type="button" data-inventory-action="close" aria-label="보상함 닫기">×</button></header>
          <nav class="inventory-filters" aria-label="보상 분류">${filters.map(([value, label]) => `<button type="button" data-inventory-filter="${value}" class="${activeInventoryFilter === value ? "is-active" : ""}" aria-pressed="${activeInventoryFilter === value}">${label}</button>`).join("")}</nav>
          <div class="inventory-list">${inventoryItemsMarkup(profile, activeInventoryFilter)}</div>
          <p class="inventory-note">아이템 장착과 꾸미기 기능은 준비 중입니다.</p>
        </section>
      </div>`;
    inventoryRoot.querySelector("[data-inventory-action='close']")?.focus();
  }

  function openInventory(trigger) {
    if (inventoryRoot) return;
    inventoryTrigger = trigger || document.activeElement;
    activeInventoryFilter = "all";
    inventoryRoot = document.createElement("div");
    inventoryRoot.className = "inventory-root";
    document.body.append(inventoryRoot);
    renderInventory();
    document.body.classList.add("inventory-open");
    inventoryRoot.addEventListener("click", (event) => {
      if (event.target.matches("[data-inventory-dismiss='true']") || event.target.closest("[data-inventory-action='close']")) {
        closeInventory();
        return;
      }
      const filter = event.target.closest("[data-inventory-filter]")?.dataset.inventoryFilter;
      if (filter) {
        activeInventoryFilter = filter;
        renderInventory();
      }
    });
  }

  function closeInventory(options = {}) {
    inventoryRoot?.remove();
    inventoryRoot = null;
    document.body.classList.remove("inventory-open");
    if (options.restoreFocus !== false) inventoryTrigger?.focus();
    inventoryTrigger = null;
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-nav-target]")?.dataset.navTarget;
    if (target === "minihome") openMinihome();
    if (target === "map") closeMinihome();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (inventoryRoot) closeInventory();
    else if (resultRoot) closeResult();
    else if (minihomeRoot?.classList.contains("is-open")) closeMinihome();
  });

  root.FoodMileRewardUI = Object.freeze({ showRewardResult, openMinihome, closeMinihome, openInventory, closeInventory });
})(globalThis);
