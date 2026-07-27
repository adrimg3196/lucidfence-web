const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ACCURACY_M = 500;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function distanceM(aLat, aLng, bLat, bLng) {
  const radians = value => value * Math.PI / 180;
  const earthM = 6371000;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthM * Math.asin(Math.sqrt(value));
}

function rejected(device, reason) {
  return {
    ...device,
    fenceState: 'unknown',
    matchedFenceId: null,
    locationQuality: 'rejected',
    locationRejectionReason: reason
  };
}

function classifyDevice(device, fences, nowMs, maxAgeMs, maxAccuracyM) {
  if (!device || typeof device !== 'object' || Array.isArray(device)) return device;
  const lat = finiteNumber(device.lat);
  const lng = finiteNumber(device.lng);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return rejected(device, 'invalid_coordinates');
  }

  const observedAt = device.locationObservedAt ?? device.observedAt;
  const observedMs = typeof observedAt === 'string' ? Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(observedMs)) return rejected(device, 'invalid_timestamp');
  if (observedMs > nowMs + 60_000) return rejected(device, 'future');
  if (nowMs - observedMs > maxAgeMs) return rejected(device, 'stale');

  const accuracy = finiteNumber(device.accuracyM ?? device.locationAccuracyM);
  if (accuracy === null || accuracy < 0) return rejected(device, 'invalid_accuracy');
  if (accuracy > maxAccuracyM) return rejected(device, 'inaccurate');
  if (!fences.length) return rejected(device, 'no_geofences');

  const match = fences.find(fence => distanceM(lat, lng, fence.lat, fence.lng) <= fence.radiusM);
  return {
    ...device,
    fenceState: match ? 'inside' : 'outside',
    matchedFenceId: match?.id ?? null,
    locationQuality: 'accepted',
    locationRejectionReason: null
  };
}

function validFences(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(fence => {
    if (!fence || typeof fence !== 'object' || Array.isArray(fence)) return [];
    const lat = finiteNumber(fence.lat);
    const lng = finiteNumber(fence.lng);
    const radiusM = finiteNumber(fence.radiusM);
    if (lat === null || lng === null || radiusM === null || lat < -90 || lat > 90 ||
        lng < -180 || lng > 180 || radiusM <= 0 || radiusM > 1_000_000) return [];
    return [{ id: String(fence.id || ''), lat, lng, radiusM }];
  });
}

export function evaluateWorkspaceGeofences(state, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.devices)) return state;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs >= 0 ? options.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const maxAccuracyM = Number.isFinite(options.maxAccuracyM) && options.maxAccuracyM >= 0 ? options.maxAccuracyM : DEFAULT_MAX_ACCURACY_M;
  const fences = validFences(state.geofences);
  return { ...state, devices: state.devices.map(device => classifyDevice(device, fences, nowMs, maxAgeMs, maxAccuracyM)) };
}
