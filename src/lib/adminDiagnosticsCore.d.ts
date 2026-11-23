export type RecitationDiagnosticStatus = "excellent" | "review" | "retry" | "invalid";

export function getRecitationDiagnosticStatus(accuracy: number): RecitationDiagnosticStatus;
export function getMediaStreamChecks(stream: MediaStream | null): {
  audio: boolean;
  video: boolean;
  ready: boolean;
};
