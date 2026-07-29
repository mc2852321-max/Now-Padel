export function canPlayNonstopSound(
  isPresentationMode: boolean,
  visibilityState: DocumentVisibilityState | "unavailable",
): boolean {
  return !isPresentationMode && visibilityState !== "unavailable";
}
