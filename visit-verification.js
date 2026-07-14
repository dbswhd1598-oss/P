(function initFoodMileVisitVerification(root) {
  "use strict";

  const VISIT_VERIFICATION_RADIUS_METERS = 100;
  const VISIT_MAX_ACCURACY_METERS = 80;
  const VISIT_REWARD_POINTS = root.FoodMileRewardConstants.VISIT_REWARD_POINTS;
  const VISIT_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
  const VISIT_GEOLOCATION_OPTIONS = Object.freeze({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });
  const POINTS_STORAGE_KEY = "foodmile_demo_points";
  const VERIFICATIONS_STORAGE_KEY = "foodmile_visit_verifications";
  const isLocalHost = ["localhost", "127.0.0.1"].includes(root.location?.hostname || "");
  const isDevelopmentTestMode =
    isLocalHost && new URLSearchParams(root.location.search).get("visitTestMode") === "true";

  let modalElement = null;
  let activeContext = null;
  let activeTrigger = null;
  let activeCallbacks = {};
  let previewUrl = null;
  let photoReady = false;
  let verifiedPosition = null;
  let verificationMode = "browser-gps";
  let geolocationRequestToken = 0;

  function safeJsonRead(key, fallback) {
    try {
      const value = JSON.parse(root.localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function verificationRecords() {
    const records = safeJsonRead(VERIFICATIONS_STORAGE_KEY, []);
    return Array.isArray(records) ? records.filter((record) => record && record.storeId) : [];
  }

  function recentVerification(storeId, now = Date.now()) {
    return verificationRecords().find(
      (record) => record.storeId === storeId && now - Number(record.verifiedAt) < VISIT_DUPLICATE_WINDOW_MS,
    ) || null;
  }

  function isRecentlyVerified(storeId, now = Date.now()) {
    return Boolean(storeId && recentVerification(storeId, now));
  }

  function demoPoints() {
    const points = Number(root.localStorage.getItem(POINTS_STORAGE_KEY) || 0);
    return Number.isFinite(points) ? points : 0;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function setTriggerLoading(isLoading) {
    if (!activeTrigger) return;
    activeTrigger.disabled = isLoading;
    activeTrigger.classList.toggle("is-locating", isLoading);
    activeTrigger.setAttribute("aria-busy", String(isLoading));
    activeTrigger.innerHTML = isLoading
      ? '<span class="visit-button-spinner" aria-hidden="true"></span>위치 확인 중...'
      : "방문 인증";
  }

  function modalShell(content) {
    return `
      <div class="visit-modal-backdrop" data-visit-dismiss="backdrop">
        <section class="visit-modal" role="dialog" aria-modal="true" aria-labelledby="visit-modal-title">
          <button class="visit-modal-close" type="button" aria-label="방문 인증 창 닫기" data-visit-action="cancel">×</button>
          ${content}
          <p class="visit-live-region" role="status" aria-live="polite"></p>
        </section>
      </div>
    `;
  }

  function ensureModal(content) {
    if (!modalElement) {
      modalElement = document.createElement("div");
      modalElement.className = "visit-modal-root";
      document.body.append(modalElement);
    }
    modalElement.innerHTML = modalShell(content);
    document.body.classList.add("visit-modal-open");
    modalElement.querySelector(".visit-modal-close")?.focus();
  }

  function updateLiveMessage(message) {
    const liveRegion = modalElement?.querySelector(".visit-live-region");
    if (liveRegion) liveRegion.textContent = message;
  }

  function cleanupPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    photoReady = false;
  }

  function closeModal(options = {}) {
    geolocationRequestToken += 1;
    cleanupPreview();
    setTriggerLoading(false);
    modalElement?.remove();
    modalElement = null;
    document.body.classList.remove("visit-modal-open");
    if (options.restoreFocus !== false) activeTrigger?.focus();
    activeTrigger = null;
    const closedContext = activeContext;
    activeContext = null;
    verifiedPosition = null;
    activeCallbacks.onClose?.(closedContext);
    activeCallbacks = {};
  }

  function showResult(title, message, secondary = "") {
    setTriggerLoading(false);
    ensureModal(`
      <div class="visit-result" data-visit-stage="result">
        <span class="visit-result-icon" aria-hidden="true">!</span>
        <h2 id="visit-modal-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        ${secondary ? `<small>${escapeHtml(secondary)}</small>` : ""}
        <button class="visit-confirm-button" type="button" aria-label="안내 확인" data-visit-action="cancel">확인</button>
      </div>
    `);
    updateLiveMessage(`${title}. ${message}`);
  }

  function renderLocating() {
    const testControls = isDevelopmentTestMode
      ? `
        <aside class="visit-test-panel" aria-label="개발 테스트 모드">
          <strong>개발 테스트 모드</strong>
          <p>로컬 개발 환경에서만 표시되며 운영 배포에서는 비활성화됩니다.</p>
          <button type="button" aria-label="선택한 가게 위치로 테스트" data-visit-action="test-near">가게 위치로 테스트</button>
          <button type="button" aria-label="실제 GPS 위치로 테스트" data-visit-action="real-gps">실제 GPS로 테스트</button>
          <details>
            <summary>GPS 오류 시나리오</summary>
            <div>
              <button type="button" aria-label="거리 초과 테스트" data-visit-action="test-far">거리 초과</button>
              <button type="button" aria-label="GPS 정확도 부족 테스트" data-visit-action="test-accuracy">정확도 부족</button>
              <button type="button" aria-label="위치 권한 거부 테스트" data-visit-action="test-denied">권한 거부</button>
              <button type="button" aria-label="위치 확인 시간 초과 테스트" data-visit-action="test-timeout">시간 초과</button>
            </div>
          </details>
        </aside>`
      : "";

    ensureModal(`
      <div class="visit-locating" data-visit-stage="locating">
        <span class="visit-location-spinner" aria-hidden="true"></span>
        <h2 id="visit-modal-title">위치 확인 중...</h2>
        <p>${escapeHtml(activeContext.name)} 근처에 있는지 확인하고 있어요.</p>
        <small>위치는 이번 방문 인증 판정에만 사용됩니다.</small>
        ${testControls}
        <button class="visit-cancel-button" type="button" aria-label="위치 확인 취소" data-visit-action="cancel">취소</button>
      </div>
    `);
    updateLiveMessage("현재 위치를 확인하고 있습니다.");
  }

  function mapGeolocationError(error) {
    if (error?.code === 1) {
      return ["위치 권한이 필요해요", "방문 인증을 위해 위치 권한이 필요해요."];
    }
    if (error?.code === 3) {
      return ["현재 위치를 확인하지 못했어요", "현재 위치를 확인하지 못했어요. 다시 시도해주세요."];
    }
    return ["위치 서비스를 확인해주세요", "기기의 위치 서비스를 켜고 다시 시도해주세요."];
  }

  function renderPhotoStep() {
    setTriggerLoading(false);
    const testPhotoButton = isDevelopmentTestMode
      ? '<button class="visit-test-photo" type="button" aria-label="개발 테스트 사진 사용" data-visit-action="test-photo">개발 테스트 사진 사용</button>'
      : "";
    ensureModal(`
      <div class="visit-photo-step" data-visit-stage="photo">
        <p class="visit-location-badge">✓ 현재 위치 인증 완료</p>
        <h2 id="visit-modal-title">방문 인증</h2>
        <p class="visit-store-name">${escapeHtml(activeContext.name)}</p>
        <div class="visit-photo-preview is-empty">
          <img alt="선택한 방문 인증 사진 미리보기" hidden />
          <span>사진 미리보기</span>
        </div>
        <div class="visit-photo-pickers">
          <label aria-label="카메라로 방문 인증 사진 촬영">
            <input type="file" accept="image/*" capture="environment" data-visit-photo-input="camera" aria-label="사진 촬영" />
            <span>사진 촬영</span>
          </label>
          <label aria-label="갤러리에서 방문 인증 사진 선택">
            <input type="file" accept="image/*" data-visit-photo-input="gallery" aria-label="갤러리 선택" />
            <span>갤러리 선택</span>
          </label>
        </div>
        ${testPhotoButton}
        <button class="visit-retake-button" type="button" aria-label="방문 인증 사진 다시 선택" data-visit-action="retake" hidden>다시 촬영</button>
        <button class="visit-complete-button" type="button" aria-label="방문 인증 완료" data-visit-action="complete" disabled>인증 완료</button>
        <button class="visit-cancel-button" type="button" aria-label="방문 인증 취소" data-visit-action="cancel">취소</button>
        <small class="visit-demo-note">사진은 서버로 전송되지 않으며 새로고침 전까지만 미리보기 됩니다.</small>
      </div>
    `);
    updateLiveMessage("위치 인증이 완료되었습니다. 사진을 선택해주세요.");
  }

  function showPhotoPreview(url) {
    cleanupPreview();
    previewUrl = url;
    photoReady = true;
    const preview = modalElement?.querySelector(".visit-photo-preview");
    const image = preview?.querySelector("img");
    const placeholder = preview?.querySelector("span");
    if (preview && image) {
      preview.classList.remove("is-empty");
      image.src = previewUrl;
      image.hidden = false;
      if (placeholder) placeholder.hidden = true;
    }
    const completeButton = modalElement?.querySelector(".visit-complete-button");
    const retakeButton = modalElement?.querySelector(".visit-retake-button");
    if (completeButton) completeButton.disabled = false;
    if (retakeButton) retakeButton.hidden = false;
    updateLiveMessage("사진이 선택되었습니다. 인증 완료 버튼을 누를 수 있습니다.");
  }

  function handlePhotoFile(file) {
    if (!file || !String(file.type || "").startsWith("image/")) return;
    showPhotoPreview(URL.createObjectURL(file));
  }

  function handleVerifiedPosition(position, mode = "browser-gps") {
    const coords = position?.coords;
    if (!coords || !activeContext) return;
    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);
    const accuracy = Number(coords.accuracy);
    const timestamp = Number(position.timestamp || Date.now());

    if (![latitude, longitude, accuracy].every(Number.isFinite)) {
      showResult("현재 위치를 확인하지 못했어요", "현재 위치를 확인하지 못했어요. 다시 시도해주세요.");
      return;
    }
    if (accuracy > VISIT_MAX_ACCURACY_METERS) {
      showResult("GPS 정확도가 낮아요", "GPS 정확도가 낮아요. 창가나 야외에서 다시 시도해주세요.");
      return;
    }

    const distanceMeters = root.FoodMileGeo.calculateDistanceMeters(
      latitude,
      longitude,
      activeContext.latitude,
      activeContext.longitude,
    );
    if (distanceMeters > VISIT_VERIFICATION_RADIUS_METERS) {
      showResult(
        "가게 근처에서 인증해주세요",
        `현재 가게까지 약 ${Math.round(distanceMeters).toLocaleString()}m 떨어져 있어요.`,
        `가게 반경 ${VISIT_VERIFICATION_RADIUS_METERS}m 안에서 다시 시도해주세요.`,
      );
      return;
    }

    verifiedPosition = { latitude, longitude, accuracy, timestamp, distanceMeters };
    verificationMode = mode;
    renderPhotoStep();
  }

  function requestLocation(forceRealGps = false) {
    if (!activeContext) return;
    renderLocating();
    setTriggerLoading(true);
    if (isDevelopmentTestMode && !forceRealGps) {
      updateLiveMessage("개발 테스트 모드입니다. 테스트할 위치 시나리오를 선택해주세요.");
      return;
    }
    if (!root.navigator?.geolocation) {
      showResult("위치 인증을 사용할 수 없어요", "이 기기에서는 위치 인증을 사용할 수 없어요.");
      return;
    }
    const token = ++geolocationRequestToken;
    root.navigator.geolocation.getCurrentPosition(
      (position) => {
        if (token !== geolocationRequestToken || !activeContext) return;
        handleVerifiedPosition(position);
      },
      (error) => {
        if (token !== geolocationRequestToken || !activeContext) return;
        const [title, message] = mapGeolocationError(error);
        showResult(title, message);
      },
      VISIT_GEOLOCATION_OPTIONS,
    );
  }

  function showSuccessToast() {
    const toast = document.createElement("div");
    toast.className = "visit-success-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "assertive");
    toast.innerHTML = `
      <span class="visit-sparkle" aria-hidden="true">✦</span>
      <strong>방문 인증 완료!</strong>
      <b>+${VISIT_REWARD_POINTS}P</b>
      <small>데모 포인트</small>
    `;
    document.body.append(toast);
    // Keep the result readable briefly after the 800ms sparkle animation completes.
    root.setTimeout(() => toast.remove(), 1600);
  }

  function completeVerification() {
    if (!activeContext || !verifiedPosition || !photoReady) return;
    if (isRecentlyVerified(activeContext.storeId)) {
      showResult("이미 인증한 가게예요", "이 가게는 24시간에 한 번만 방문 인증할 수 있어요.");
      return;
    }

    const verifiedAt = Date.now();
    const verificationId = root.FoodMileRewards?.makeVerificationId(activeContext.storeId, verifiedAt) ||
      `${activeContext.storeId}:${verifiedAt}`;
    const record = {
      verificationId,
      storeId: activeContext.storeId,
      verifiedAt,
      latitude: Number(verifiedPosition.latitude.toFixed(6)),
      longitude: Number(verifiedPosition.longitude.toFixed(6)),
      accuracy: Math.round(verifiedPosition.accuracy),
      distanceMeters: Math.round(verifiedPosition.distanceMeters),
      mode: verificationMode,
    };
    const records = verificationRecords().filter(
      (item) => Date.now() - Number(item.verifiedAt) < VISIT_DUPLICATE_WINDOW_MS,
    );
    records.push(record);
    root.localStorage.setItem(VERIFICATIONS_STORAGE_KEY, JSON.stringify(records));
    const reward = root.FoodMileRewards?.applyVisitReward({
      verificationId,
      storeId: activeContext.storeId,
      storeName: activeContext.name,
      verifiedAt,
    });
    const nextPoints = reward?.profile?.points ?? demoPoints();

    const verifiedContext = activeContext;
    const onVerified = activeCallbacks.onVerified;
    closeModal({ restoreFocus: true });
    onVerified?.({ record, points: nextPoints, context: verifiedContext, reward });
  }

  function developmentPosition(kind) {
    const base = {
      latitude: activeContext.latitude,
      longitude: activeContext.longitude,
      accuracy: 8,
    };
    if (kind === "far") base.latitude += 0.002;
    if (kind === "accuracy") base.accuracy = 120;
    return { coords: base, timestamp: Date.now() };
  }

  function handleModalClick(event) {
    const action = event.target.closest("[data-visit-action]")?.dataset.visitAction;
    if (event.target.matches('[data-visit-dismiss="backdrop"]')) {
      closeModal();
      return;
    }
    if (!action) return;
    if (action === "cancel") closeModal();
    if (action === "retake") {
      cleanupPreview();
      renderPhotoStep();
      updateLiveMessage("사진을 다시 선택해주세요.");
    }
    if (action === "complete") completeVerification();
    if (!isDevelopmentTestMode) return;
    if (action === "real-gps") requestLocation(true);
    if (action === "test-near") {
      geolocationRequestToken += 1;
      handleVerifiedPosition(developmentPosition("near"), "development-test");
    }
    if (action === "test-far") {
      geolocationRequestToken += 1;
      handleVerifiedPosition(developmentPosition("far"), "development-test");
    }
    if (action === "test-accuracy") {
      geolocationRequestToken += 1;
      handleVerifiedPosition(developmentPosition("accuracy"), "development-test");
    }
    if (action === "test-denied") {
      geolocationRequestToken += 1;
      const [title, message] = mapGeolocationError({ code: 1 });
      showResult(title, message);
    }
    if (action === "test-timeout") {
      geolocationRequestToken += 1;
      const [title, message] = mapGeolocationError({ code: 3 });
      showResult(title, message);
    }
    if (action === "test-photo") {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#f3b35d"/><circle cx="400" cy="300" r="180" fill="#ee6267"/><text x="400" y="320" text-anchor="middle" font-size="52" fill="white">FoodMile TEST</text></svg>';
      showPhotoPreview(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
      verificationMode = "development-test";
    }
  }

  function open(context, callbacks = {}) {
    if (modalElement || !context?.storeId || !Number.isFinite(context.latitude) || !Number.isFinite(context.longitude)) {
      return false;
    }
    activeContext = context;
    activeTrigger = context.triggerButton || document.activeElement;
    activeCallbacks = callbacks;
    if (isRecentlyVerified(context.storeId)) {
      showResult("이미 인증한 가게예요", "이 가게는 24시간에 한 번만 방문 인증할 수 있어요.");
      return true;
    }
    requestLocation();
    return true;
  }

  document.addEventListener("click", (event) => {
    if (modalElement?.contains(event.target)) handleModalClick(event);
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-visit-photo-input]")) handlePhotoFile(event.target.files?.[0]);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalElement) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeModal();
    }
  });

  root.FoodMileVisitVerification = Object.freeze({
    VISIT_VERIFICATION_RADIUS_METERS,
    VISIT_MAX_ACCURACY_METERS,
    VISIT_REWARD_POINTS,
    VISIT_GEOLOCATION_OPTIONS,
    POINTS_STORAGE_KEY,
    VERIFICATIONS_STORAGE_KEY,
    open,
    close: closeModal,
    isRecentlyVerified,
    recentVerification,
    getDemoPoints: demoPoints,
    getRecords: verificationRecords,
    isDevelopmentTestMode: () => isDevelopmentTestMode,
  });
})(globalThis);
