(function initFoodMileGeo(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FoodMileGeo = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createFoodMileGeo() {
  const EARTH_RADIUS_METERS = 6371008.8;

  function degreesToRadians(value) {
    return (Number(value) * Math.PI) / 180;
  }

  function calculateDistanceMeters(userLatitude, userLongitude, storeLatitude, storeLongitude) {
    const lat1 = degreesToRadians(userLatitude);
    const lat2 = degreesToRadians(storeLatitude);
    const deltaLat = degreesToRadians(Number(storeLatitude) - Number(userLatitude));
    const deltaLng = degreesToRadians(Number(storeLongitude) - Number(userLongitude));
    const haversine =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
  }

  return { EARTH_RADIUS_METERS, calculateDistanceMeters };
});
