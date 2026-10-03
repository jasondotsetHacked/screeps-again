import { compareSafetyRequests, type SafetyRequest } from '../colony/planSafety';

// One selection across all colony requests, before any activation mutation.
// Earlier projected loss wins, then critical asset value, RCL, and stable IDs.
export function arbitrateSafety(requests: readonly SafetyRequest[], protectionActive: boolean): SafetyRequest | undefined {
  if (protectionActive) return undefined;
  let best: SafetyRequest | undefined;
  for (const request of requests) {
    if (!best || compareSafetyRequests(request, best) < 0) best = request;
  }
  return best;
}
