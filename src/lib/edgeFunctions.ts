import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

// supabase-js's functions.invoke() collapses a non-2xx response down to a
// generic "Edge Function returned a non-2xx status code" message — the
// actual reason (our functions' `{ error: "..." }` JSON body) has to be
// read separately off FunctionsHttpError.context. This wraps that so every
// caller gets the real message instead of the useless wrapper text.
export async function invokeEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const parsed = await error.context.json()
        if (typeof parsed?.error === 'string') return { data: null, error: parsed.error }
      } catch {
        // response body wasn't JSON (e.g. the function isn't deployed) — fall through
      }
    }
    return { data: null, error: error.message }
  }

  if (data && typeof data === 'object' && 'error' in data && data.error) {
    return { data: null, error: String((data as { error: unknown }).error) }
  }

  return { data: data as T, error: null }
}
