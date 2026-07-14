(function initFoodMileRoomEngine(root) {
  "use strict";

  const C = root.FoodMileRoomConstants;
  if (!C) throw new Error("FoodMileRoomConstants must load before room-engine.js");

  const mountedRooms = new Set();
  const assetRegistry = new Map();
  const isDevelopmentMode = ["localhost", "127.0.0.1"].includes(root.location?.hostname || "");

  function safeStorage() {
    try { return root.localStorage || null; } catch { return null; }
  }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function sanitizeItem(item, fallback) {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: String(source.id || fallback.id),
      type: String(source.type || fallback.type),
      asset: String(source.asset || fallback.asset),
      x: Math.max(0, Math.min(100, finite(source.x, fallback.x))),
      y: Math.max(0, Math.min(100, finite(source.y, fallback.y))),
      layer: String(source.layer || fallback.layer),
      rotation: finite(source.rotation, fallback.rotation),
      scale: Math.max(0.1, finite(source.scale, fallback.scale)),
      zIndex: finite(source.zIndex, fallback.zIndex),
    };
  }

  function defaultRoom() {
    return {
      wallpaper: C.DEFAULT_ROOM.wallpaper,
      floor: C.DEFAULT_ROOM.floor,
      window: C.DEFAULT_ROOM.window,
      furniture: C.DEFAULT_ROOM.furniture.map((item) => ({ ...item })),
      decorations: C.DEFAULT_ROOM.decorations.map((item) => ({ ...item })),
    };
  }

  function sanitizeRoom(value) {
    const base = defaultRoom();
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const sanitizeList = (items, defaults, defaultLayer) => {
      const list = Array.isArray(items) ? items : defaults;
      return list.map((item, index) => {
        const known = defaults.find((candidate) => candidate.id === item?.id);
        const fallback = known || {
          id: `${defaultLayer}_${index + 1}`,
          type: defaultLayer === "decorationBack" ? "decoration" : "furniture",
          asset: "placeholder_generic",
          x: 50,
          y: 50,
          layer: defaultLayer,
          rotation: 0,
          scale: 1,
          zIndex: defaultLayer === "decorationBack" ? 0 : 2,
        };
        return sanitizeItem(item, fallback);
      });
    };
    return {
      wallpaper: typeof source.wallpaper === "string" && source.wallpaper ? source.wallpaper : base.wallpaper,
      floor: typeof source.floor === "string" && source.floor ? source.floor : base.floor,
      window: typeof source.window === "string" && source.window ? source.window : base.window,
      furniture: sanitizeList(source.furniture, base.furniture, "furniture"),
      decorations: sanitizeList(source.decorations, base.decorations, "decorationBack"),
    };
  }

  function loadRoom(storage = safeStorage()) {
    try {
      const raw = storage?.getItem(C.ROOM_STORAGE_KEY);
      return sanitizeRoom(raw ? JSON.parse(raw) : C.DEFAULT_ROOM);
    } catch (error) {
      console.warn("FoodMile room data was damaged and has been reset.", error);
      return defaultRoom();
    }
  }

  function saveRoom(room, storage = safeStorage()) {
    const sanitized = sanitizeRoom(room);
    storage?.setItem(C.ROOM_STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  }

  function itemStyle(item) {
    return `--room-x:${item.x}%;--room-y:${item.y}%;--room-rotation:${item.rotation}deg;--room-scale:${item.scale};--room-item-z:${item.zIndex}`;
  }

  function renderItem(item) {
    const asset = assetRegistry.get(item.asset);
    const content = asset?.src
      ? `<img src="${asset.src}" alt="" draggable="false" />`
      : `<span>${item.type.toUpperCase()}<small>PLACEHOLDER</small></span>`;
    return `<div class="room-item room-item--${item.type}" data-room-item="${item.id}" data-room-z="${item.zIndex}" style="${itemStyle(item)}" aria-hidden="true">${content}</div>`;
  }

  function renderAnchor(anchorData) {
    return `<span class="room-debug-anchor room-debug-anchor--${anchorData.type}" data-room-anchor="${anchorData.id}" style="--room-x:${anchorData.position.x}%;--room-y:${anchorData.position.y}%"><b>${anchorData.type}</b><small>${anchorData.position.x}, ${anchorData.position.y}</small></span>`;
  }

  function renderLayer(layer, room) {
    const behindAvatar = room.furniture.filter((item) => item.zIndex <= 1);
    const frontAvatar = room.furniture.filter((item) => item.zIndex > 1);
    let content = "";
    if (layer.id === "sky") content = '<div class="room-sky-placeholder">SKY LAYER</div>';
    if (layer.id === "wall") content = `
      <div class="room-wall-placeholder" data-room-wall="${room.wallpaper}"><span>WALL PLACEHOLDER</span></div>
      <div class="room-floor-placeholder" data-room-floor="${room.floor}"><span>FLOOR PLACEHOLDER</span></div>
      <span class="room-avatar-ground-line" aria-hidden="true">AVATAR GROUND LINE</span>`;
    if (layer.id === "window") {
      const anchorData = C.SPECIAL_ANCHORS.window;
      content = `<div class="room-window-placeholder" data-room-window="${room.window}" style="--room-x:${anchorData.position.x}%;--room-y:${anchorData.position.y}%"><span>WINDOW<br />PLACEHOLDER</span></div>`;
    }
    if (layer.id === "decorationBack") content = [...room.decorations, ...behindAvatar].map(renderItem).join("");
    if (layer.id === "avatar") {
      const avatar = C.SPECIAL_ANCHORS.avatar;
      content = `<div class="room-avatar-slot" data-room-avatar-mount style="--room-x:${avatar.position.x}%;--room-y:${avatar.position.y}%"></div>`;
    }
    if (layer.id === "furniture") content = frontAvatar.map(renderItem).join("");
    if (layer.id === "effect") content = '<div class="room-effect-placeholder" aria-hidden="true"></div>';
    if (layer.id === "ui" && isDevelopmentMode) {
      content = `<div class="room-debug-grid" aria-hidden="true"></div>${[
        C.SPECIAL_ANCHORS.window,
        C.SPECIAL_ANCHORS.avatar,
        ...C.FURNITURE_ANCHORS,
      ].map(renderAnchor).join("")}`;
    }
    return `<div class="room-layer room-layer--${layer.id}" data-room-layer="${layer.id}" aria-label="${layer.label}">${content}</div>`;
  }

  function render(container, room = loadRoom()) {
    if (!container) return null;
    const state = saveRoom(room);
    container.classList.add("foodmile-room");
    container.dataset.roomCanvas = `${C.ROOM_CANVAS.width}x${C.ROOM_CANVAS.height}`;
    container.dataset.roomDebug = String(isDevelopmentMode);
    container.innerHTML = C.ROOM_LAYER_ORDER.map((layer) => renderLayer(layer, state)).join("");
    root.FoodMileAvatarEngine?.mount(container.querySelector("[data-room-avatar-mount]"));
    return state;
  }

  function mount(container) {
    if (!container) return null;
    mountedRooms.add(container);
    return render(container, loadRoom());
  }

  function unmount(container) {
    root.FoodMileAvatarEngine?.unmount(container?.querySelector("[data-room-avatar-mount]"));
    mountedRooms.delete(container);
  }

  function refresh(room) {
    const state = saveRoom(room);
    mountedRooms.forEach((container) => {
      if (container?.isConnected !== false) render(container, state);
      else mountedRooms.delete(container);
    });
    return state;
  }

  function registerAsset(asset) {
    if (!asset?.id || !asset?.src) return false;
    assetRegistry.set(String(asset.id), { ...asset });
    return true;
  }

  const api = Object.freeze({
    mount,
    unmount,
    render,
    refresh,
    loadRoom,
    saveRoom,
    sanitizeRoom,
    defaultRoom,
    registerAsset,
    getLayerOrder: () => C.ROOM_LAYER_ORDER.map((layer) => ({ ...layer })),
    getAnchors: () => ({
      window: { ...C.SPECIAL_ANCHORS.window, position: { ...C.SPECIAL_ANCHORS.window.position } },
      avatar: { ...C.SPECIAL_ANCHORS.avatar, position: { ...C.SPECIAL_ANCHORS.avatar.position } },
      furniture: C.FURNITURE_ANCHORS.map((item) => ({ ...item, position: { ...item.position } })),
    }),
    getCanvasSpec: () => ({ ...C.ROOM_CANVAS }),
    isDevelopmentMode: () => isDevelopmentMode,
  });

  root.FoodMileRoomEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
