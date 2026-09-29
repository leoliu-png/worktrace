export function homeLoginDestination(hasSession: boolean) {
  return hasSession ? '/console' : undefined;
}
