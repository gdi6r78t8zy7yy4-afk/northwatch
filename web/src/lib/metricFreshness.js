// Human-readable age for a source observation. This describes elapsed time only;
// freshness thresholds are intentionally not inferred because source cadences differ.
export function formatObservationAge(timestamp, now = Date.now()) {
  if (typeof timestamp !== 'string' || !timestamp.trim()) return 'age unavailable';
  const observedAt = Date.parse(timestamp);
  if (!Number.isFinite(observedAt)) return 'age unavailable';
  const deltaMs = now - observedAt;
  if (deltaMs < 0) {
    const minutes = Math.ceil(Math.abs(deltaMs) / 60000);
    return minutes <= 1 ? '1 min ahead' : `${minutes} min ahead`;
  }
  const totalMinutes = Math.floor(deltaMs / 60000);
  if (totalMinutes < 1) return 'just now';
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h ago` : `${days}d ago`;
}
