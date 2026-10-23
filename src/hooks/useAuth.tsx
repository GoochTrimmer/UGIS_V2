import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthValue {
  session: Session | null | undefined
  loading: boolean
  signIn: (email: string, password: string) => ReturnType<typeof supabase.auth.signInWithPassword>
  signOut: () => ReturnType<typeof supabase.auth.signOut>
}

const AuthContext = createContext<AuthValue | null>(null)

// A single shared session, fetched once here rather than per-component —
// every page renders its own <Layout>, so a component-local useState would
// re-run getSession() (and start back at `undefined`) on every navigation.
// That's what caused the staff-only nav items to flash visible for a
// consignee account before narrowing down to their real role each time
// they switched tabs.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const queryClient = useQueryClient()
  const lastUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    // The query cache lives in memory for the whole SPA session and isn't
    // keyed by user, so without this a different account signing in on the
    // same tab briefly sees the previous account's items/logs/brands until
    // a refetch (or full page reload) replaces them. Drop everything
    // whenever the signed-in user actually changes (incl. sign-out).
    const applySession = (sess: Session | null) => {
      const userId = sess?.user?.id ?? null
      if (lastUserId.current !== undefined && lastUserId.current !== userId) {
        queryClient.clear()
      }
      lastUserId.current = userId
      setSession(sess)
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      applySession(sess)
    })
    return () => subscription.unsubscribe()
  }, [queryClient])

  const signIn = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, loading: session === undefined, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
