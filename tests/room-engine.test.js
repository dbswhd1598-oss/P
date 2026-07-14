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
global.FoodMileRoomConstants = require("../room.constants.js");
const Room = require("../room-engine.js");

assert.deepEqual(
  Room.getLayerOrder().map((layer) => layer.id),
  ["sky", "wall", "window", "decorationBack", "avatar", "furniture", "effect", "ui"],
);
assert.deepEqual(Room.getCanvasSpec(), { width: 800, height: 600, aspectRatio: "4:3" });

const anchors = Room.getAnchors();
assert.deepEqual(anchors.window.position, { x: 50, y: 90 });
assert.deepEqual(anchors.avatar.position, { x: 50, y: 25 });
assert.equal(anchors.furniture.length, 8);
assert.deepEqual(
  anchors.furniture.map(({ id, position, layer, rotation, scale }) => ({ id, position, layer, rotation, scale })),
  [
    { id: "bed_01", position: { x: 12, y: 50 }, layer: "furniture", rotation: 0, scale: 1 },
    { id: "desk_01", position: { x: 85, y: 50 }, layer: "furniture", rotation: 0, scale: 1 },
    { id: "shelf_01", position: { x: 88, y: 90 }, layer: "furniture", rotation: 0, scale: 1 },
    { id: "plant_01", position: { x: 96, y: 50 }, layer: "furniture", rotation: 0, scale: 1 },
    { id: "rug_01", position: { x: 50, y: 25 }, layer: "furniture", rotation: 0, scale: 1 },
    { id: "lamp_01", position: { x: 78, y: 56 }, layer: "furniture", rotation: 0, scale: 1 },
    { id: "chair_01", position: { x: 74, y: 31 }, layer: "furniture", rotation: 0, scale: 1 },
    { id: "deco_01", position: { x: 28, y: 72 }, layer: "decorationBack", rotation: 0, scale: 1 },
  ],
);

const room = Room.defaultRoom();
assert.equal(room.wallpaper, "wallpaper_placeholder_default");
assert.equal(room.floor, "floor_placeholder_default");
assert.equal(room.furniture.find((item) => item.id === "plant_01").zIndex, 1);
assert.equal(room.furniture.find((item) => item.id === "rug_01").zIndex, 1);
assert.equal(room.furniture.find((item) => item.id === "chair_01").zIndex, 2);

room.furniture.find((item) => item.id === "chair_01").rotation = 12;
const saved = Room.saveRoom(room);
assert.equal(Room.loadRoom().furniture.find((item) => item.id === "chair_01").rotation, 12);
assert.deepEqual(JSON.parse(global.localStorage.getItem("foodmile_room")), saved);

const restoredStorage = memoryStorage({ foodmile_room: JSON.stringify(saved) });
assert.deepEqual(Room.loadRoom(restoredStorage), saved);

const futureFurniture = {
  ...saved,
  furniture: [...saved.furniture, { id: "future_sofa", type: "sofa", asset: "sofa.png", x: 42, y: 33, rotation: 5, scale: 0.9, zIndex: 2 }],
};
assert.equal(Room.saveRoom(futureFurniture).furniture.find((item) => item.id === "future_sofa").asset, "sofa.png");

const damagedStorage = memoryStorage({ foodmile_room: "{bad-json" });
assert.doesNotThrow(() => Room.loadRoom(damagedStorage));
assert.deepEqual(Room.loadRoom(damagedStorage), Room.defaultRoom());
assert.equal(Room.isDevelopmentMode(), true);

console.log("room-engine.test.js: layer order, anchors, z-index, persistence and recovery checks passed");
