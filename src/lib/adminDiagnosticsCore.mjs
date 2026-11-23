export function getRecitationDiagnosticStatus(accuracy) {
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) return "invalid";
  if (accuracy >= 90) return "excellent";
  if (accuracy >= 70) return "review";
  return "retry";
}

export function getMediaStreamChecks(stream) {
  if (!stream) return { audio: false, video: false, ready: false };
  const audio = stream.getAudioTracks().some((track) => track.readyState === "live" && track.enabled);
  const video = stream.getVideoTracks().some((track) => track.readyState === "live" && track.enabled);
  return { audio, video, ready: audio && video };
}
