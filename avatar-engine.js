(function initFoodMileAvatarEngine(root) {
  "use strict";

  const C = root.FoodMileAvatarConstants;
  if (!C) throw new Error("FoodMileAvatarConstants must load before avatar-engine.js");

  const mountedContainers = new Set();
  const assetRegistry = new Map();
  Object.entries(C.PLACEHOLDER_ASSETS).forEach(([part, assets]) => {
    assets.forEach((asset) => assetRegistry.set(`${part}:${asset.id}`, {
      ...asset,
      part,
      src: null,
      width: C.AVATAR_CANVAS.width,
      height: C.AVATAR_CANVAS.height,
      pivot: C.AVATAR_PIVOT,
    }));
  });

  function safeStorage() {
    try { return root.localStorage || null; } catch { return null; }
  }

  function sanitizeAvatar(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.keys(C.DEFAULT_AVATAR).map((key) => [
      key,
      typeof source[key] === "string" && source[key] ? source[key] : C.DEFAULT_AVATAR[key],
    ]));
  }

  function loadAvatar(storage = safeStorage()) {
    try {
      const raw = storage?.getItem(C.AVATAR_STORAGE_KEY);
      return sanitizeAvatar(raw ? JSON.parse(raw) : C.DEFAULT_AVATAR);
    } catch (error) {
      console.warn("FoodMile avatar data was damaged and has been reset.", error);
      return sanitizeAvatar(C.DEFAULT_AVATAR);
    }
  }

  function saveAvatar(avatar, storage = safeStorage()) {
    const sanitized = sanitizeAvatar(avatar);
    storage?.setItem(C.AVATAR_STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  }

  function assetFor(part, id) {
    return assetRegistry.get(`${part}:${id}`) || assetRegistry.get(`${part}:${C.DEFAULT_AVATAR[part]}`) || null;
  }

  function renderLayer(layer, avatar) {
    const asset = assetFor(layer.dataKey, avatar[layer.dataKey]);
    if (!asset || asset.hidden) return `<div class="avatar-layer avatar-layer--${layer.slot}" data-avatar-layer="${layer.slot}" data-avatar-asset="${avatar[layer.dataKey]}" aria-hidden="true"></div>`;
    const content = asset.src
      ? `<img src="${asset.src}" width="${C.AVATAR_CANVAS.width}" height="${C.AVATAR_CANVAS.height}" alt="" draggable="false" />`
      : `<span class="avatar-layer-shape" aria-hidden="true"></span><small>${asset.placeholder || layer.label}</small>`;
    return `<div class="avatar-layer avatar-layer--${layer.slot} avatar-tone--${asset.tone || "neutral"}" data-avatar-layer="${layer.slot}" data-avatar-asset="${asset.id}" aria-hidden="true">${content}</div>`;
  }

  function render(container, avatar = loadAvatar()) {
    if (!container) return null;
    const state = sanitizeAvatar(avatar);
    container.classList.add("foodmile-avatar");
    container.setAttribute("role", "img");
    container.setAttribute("aria-label", "Starter Avatar Placeholder");
    container.dataset.avatarAnchor = C.AVATAR_PIVOT.anchor;
    container.dataset.avatarCanvas = `${C.AVATAR_CANVAS.width}x${C.AVATAR_CANVAS.height}`;
    container.innerHTML = `
      <div class="avatar-canvas" style="--avatar-canvas-width:${C.AVATAR_CANVAS.width};--avatar-canvas-height:${C.AVATAR_CANVAS.height}">
        ${C.AVATAR_LAYER_ORDER.map((layer) => renderLayer(layer, state)).join("")}
        <span class="avatar-pivot" aria-hidden="true">PIVOT</span>
      </div>`;
    return state;
  }

  function refreshMounted(avatar) {
    mountedContainers.forEach((container) => {
      if (container?.isConnected !== false) render(container, avatar);
      else mountedContainers.delete(container);
    });
  }

  function mount(container) {
    if (!container) return null;
    mountedContainers.add(container);
    return render(container, loadAvatar());
  }

  function unmount(container) {
    mountedContainers.delete(container);
  }

  function updateAvatar(changes) {
    const avatar = saveAvatar({ ...loadAvatar(), ...changes });
    refreshMounted(avatar);
    return avatar;
  }

  function setPart(part, assetId) {
    if (!Object.prototype.hasOwnProperty.call(C.DEFAULT_AVATAR, part)) throw new Error(`Unknown avatar part: ${part}`);
    return updateAvatar({ [part]: String(assetId || C.DEFAULT_AVATAR[part]) });
  }

  function setHair(frontAssetId, backAssetId) {
    return updateAvatar({
      hairFront: String(frontAssetId || C.DEFAULT_AVATAR.hairFront),
      hairBack: String(backAssetId || C.DEFAULT_AVATAR.hairBack),
    });
  }

  function setTop(assetId) { return setPart("top", assetId); }
  function setBottom(assetId) { return setPart("bottom", assetId); }
  function setShoes(assetId) { return setPart("shoes", assetId); }
  function setAccessory(assetId) { return setPart("accessory", assetId); }

  function registerAsset(part, asset) {
    if (!Object.prototype.hasOwnProperty.call(C.DEFAULT_AVATAR, part) || !asset?.id) return false;
    const width = Number(asset.width || C.AVATAR_CANVAS.width);
    const height = Number(asset.height || C.AVATAR_CANVAS.height);
    if (width !== C.AVATAR_CANVAS.width || height !== C.AVATAR_CANVAS.height) return false;
    assetRegistry.set(`${part}:${asset.id}`, {
      part,
      placeholder: "",
      tone: "neutral",
      ...asset,
      width,
      height,
      pivot: C.AVATAR_PIVOT,
    });
    return true;
  }

  function randomAvatar() {
    const pick = (part) => {
      const choices = C.PLACEHOLDER_ASSETS[part] || [];
      return choices[Math.floor(Math.random() * choices.length)]?.id || C.DEFAULT_AVATAR[part];
    };
    return updateAvatar({
      body: pick("body"),
      hairFront: pick("hairFront"),
      hairBack: pick("hairBack"),
      eyes: pick("eyes"),
      face: pick("face"),
      top: pick("top"),
      bottom: pick("bottom"),
      shoes: pick("shoes"),
      accessory: pick("accessory"),
    });
  }

  const isDevelopmentMode = ["localhost", "127.0.0.1"].includes(root.location?.hostname || "");
  const api = Object.freeze({
    mount,
    unmount,
    render,
    loadAvatar,
    saveAvatar,
    sanitizeAvatar,
    setPart,
    setHair,
    setTop,
    setBottom,
    setShoes,
    setAccessory,
    registerAsset,
    randomAvatar,
    getLayerOrder: () => C.AVATAR_LAYER_ORDER.map((layer) => ({ ...layer })),
    getCanvasSpec: () => ({ ...C.AVATAR_CANVAS, pivot: { ...C.AVATAR_PIVOT } }),
    getAnimationNames: () => [...C.AVATAR_ANIMATION_NAMES],
    isDevelopmentMode: () => isDevelopmentMode,
  });
  root.FoodMileAvatarEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
