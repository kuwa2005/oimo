/** Reuse Auto(無料) ranking — refs are `openrouter/...` and do not collide with Zen catalog. */
export {
  AUTO_FREE_COOLDOWN_MS as OPENROUTER_FREE_COOLDOWN_MS,
  autoFreeRef as openRouterFreeRef,
  rememberAutoFreeSuccess as rememberOpenRouterFreeSuccess,
  rememberAutoFreeFailure as rememberOpenRouterFreeFailure,
  rememberAutoFreeGood as rememberOpenRouterFreeGood,
  rememberAutoFreeBad as rememberOpenRouterFreeBad,
  reorderAutoFreeCandidates as reorderOpenRouterFreeCandidates,
} from "../auto-free/stats"
