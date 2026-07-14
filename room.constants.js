(function initFoodMileRoomConstants(root) {
  "use strict";

  const anchor = (id, type, x, y, layer, zIndex, description) => Object.freeze({
    id,
    type,
    position: Object.freeze({ x, y }),
    layer,
    rotation: 0,
    scale: 1,
    zIndex,
    description,
  });

  const constants = Object.freeze({
    ROOM_STORAGE_KEY: "foodmile_room",
    ROOM_CANVAS: Object.freeze({ width: 800, height: 600, aspectRatio: "4:3" }),
    ROOM_LAYER_ORDER: Object.freeze([
      Object.freeze({ id: "sky", label: "Sky Layer" }),
      Object.freeze({ id: "wall", label: "Wall Layer" }),
      Object.freeze({ id: "window", label: "Window Layer" }),
      Object.freeze({ id: "decorationBack", label: "Decoration Back Layer" }),
      Object.freeze({ id: "avatar", label: "Avatar Layer" }),
      Object.freeze({ id: "furniture", label: "Furniture Layer" }),
      Object.freeze({ id: "effect", label: "Effect Layer" }),
      Object.freeze({ id: "ui", label: "UI Layer" }),
    ]),
    SPECIAL_ANCHORS: Object.freeze({
      window: anchor("window_01", "window", 50, 90, "window", 0, "Window placement anchor"),
      avatar: anchor("avatar_01", "avatar", 50, 25, "avatar", 0, "Bottom-center foot anchor"),
    }),
    FURNITURE_ANCHORS: Object.freeze([
      anchor("bed_01", "bed", 12, 50, "furniture", 2, "Bed placement anchor"),
      anchor("desk_01", "desk", 85, 50, "furniture", 2, "Desk placement anchor"),
      anchor("shelf_01", "shelf", 88, 90, "furniture", 2, "Shelf placement anchor"),
      anchor("plant_01", "plant", 96, 50, "furniture", 1, "Plant behind avatar"),
      anchor("rug_01", "rug", 50, 25, "furniture", 1, "Rug behind avatar"),
      anchor("lamp_01", "lamp", 78, 56, "furniture", 2, "Lamp placement anchor"),
      anchor("chair_01", "chair", 74, 31, "furniture", 2, "Chair in front of avatar"),
      anchor("deco_01", "decoration", 28, 72, "decorationBack", 0, "Wall decoration anchor"),
    ]),
    DEFAULT_ROOM: Object.freeze({
      wallpaper: "wallpaper_placeholder_default",
      floor: "floor_placeholder_default",
      window: "window_placeholder_default",
      furniture: Object.freeze([
        Object.freeze({ id: "bed_01", type: "bed", asset: "placeholder_bed", x: 12, y: 50, layer: "furniture", rotation: 0, scale: 1, zIndex: 2 }),
        Object.freeze({ id: "desk_01", type: "desk", asset: "placeholder_desk", x: 85, y: 50, layer: "furniture", rotation: 0, scale: 1, zIndex: 2 }),
        Object.freeze({ id: "shelf_01", type: "shelf", asset: "placeholder_shelf", x: 88, y: 90, layer: "furniture", rotation: 0, scale: 1, zIndex: 2 }),
        Object.freeze({ id: "plant_01", type: "plant", asset: "placeholder_plant", x: 96, y: 50, layer: "furniture", rotation: 0, scale: 1, zIndex: 1 }),
        Object.freeze({ id: "rug_01", type: "rug", asset: "placeholder_rug", x: 50, y: 25, layer: "furniture", rotation: 0, scale: 1, zIndex: 1 }),
        Object.freeze({ id: "lamp_01", type: "lamp", asset: "placeholder_lamp", x: 78, y: 56, layer: "furniture", rotation: 0, scale: 1, zIndex: 2 }),
        Object.freeze({ id: "chair_01", type: "chair", asset: "placeholder_chair", x: 74, y: 31, layer: "furniture", rotation: 0, scale: 1, zIndex: 2 }),
      ]),
      decorations: Object.freeze([
        Object.freeze({ id: "deco_01", type: "decoration", asset: "placeholder_decoration", x: 28, y: 72, layer: "decorationBack", rotation: 0, scale: 1, zIndex: 0 }),
      ]),
    }),
  });

  root.FoodMileRoomConstants = constants;
  if (typeof module !== "undefined" && module.exports) module.exports = constants;
})(globalThis);
