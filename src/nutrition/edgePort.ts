/**
 * nutrition/edgePort.ts — the real `NutritionAiPort`, over the Supabase Edge
 * Function. Thin BY DESIGN: the injected `invoke` (supabase-js under it, wired
 * in main.ts) is the only thing that touches a network, and the pure halves in
 * aiPort.ts do all the reading — so tests cover this port with an in-memory
 * `invoke`, mocking no fetch, exactly like the sync engine's MemoryBackend.
 */

import {
  mapInvokeError,
  parseEstimate,
  type EstimateResult,
  type MealEstimateRequest,
  type NutritionAiPort,
} from './aiPort.ts';

export interface EdgeAiDeps {
  /** POST the Edge Function; `status: 0` means no HTTP answer ever arrived. */
  invoke(body: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; status: number }>;
  /** Live sign-in state — re-read on every call, sessions come and go. */
  isSignedIn(): boolean;
}

export function createEdgeAiPort(deps: EdgeAiDeps): NutritionAiPort {
  return {
    configured: () => deps.isSignedIn(),

    async estimate(req: MealEstimateRequest): Promise<EstimateResult> {
      // Signed out is knowable locally — never spend a request to find out.
      if (!deps.isSignedIn()) return { ok: false, error: 'signed_out' };
      const res = await deps.invoke({ text: req.text, ...(req.photo ? { photo: req.photo } : {}) });
      if (!res.ok) return { ok: false, error: res.status === 0 ? 'offline' : mapInvokeError(res.status) };
      const estimate = parseEstimate(res.data);
      return estimate ? { ok: true, estimate } : { ok: false, error: 'unparseable' };
    },
  };
}
