const assert = require("node:assert/strict");
const { calculateDistanceMeters } = require("../geo.js");

assert.equal(calculateDistanceMeters(37.5, 127, 37.5, 127), 0);

const oneDegreeAtEquator = calculateDistanceMeters(0, 0, 0, 1);
assert.ok(Math.abs(oneDegreeAtEquator - 111195) < 150, `equator distance: ${oneDegreeAtEquator}`);

const seoulShortDistance = calculateDistanceMeters(37.5665, 126.978, 37.56695, 126.978);
assert.ok(Math.abs(seoulShortDistance - 50.04) < 0.5, `short distance: ${seoulShortDistance}`);

console.log(JSON.stringify({
  samePointMeters: 0,
  equatorOneDegreeMeters: Math.round(oneDegreeAtEquator),
  seoulShortDistanceMeters: Number(seoulShortDistance.toFixed(2)),
}));
