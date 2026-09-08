import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useLatestReconciliationRun, useOpenDiscrepancies } from '../../hooks/useReconciliation'
import Spinner from '../ui/Spinner'
import logo from '../../assets/upstairs-garments-logo-trans-03032024.png'

const nav = [
  { to: '/',            label: 'Inventory',  icon: '▦' },
  { to: '/brands',      label: 'Brands',     icon: '◈' },
  { to: '/consignees',  label: 'Consignees', icon: '◎' },
  { to: '/import',      label: 'Import/Export', icon: '↑' },
  { to: '/shopify',     label: 'Shopify',    icon: '◇' },
  { to: '/actionable',  label: 'Actionable', icon: '⚑' },
  { to: '/logs',        label: 'History',    icon: '◷' },
  { to: '/statistics',  label: 'Statistics', icon: '◑' },
]

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { signOut, session } = useAuth()
  const navigate = useNavigate()
  const { data: latestRun } = useLatestReconciliationRun()
  const { data: openDiscrepancies } = useOpenDiscrepancies()
  const openCount = openDiscrepancies?.length ?? 0
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Mobile header — nav collapses into a hamburger menu below md, since
          the full tab list no longer fits/wraps cleanly on a phone width. */}
      <div className="md:hidden sticky top-0 z-40 bg-surface-1 border-b border-border shrink-0 relative">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Upstairs Garments" className="h-5 w-auto" />
            <span className="text-xs font-mono font-medium tracking-widest text-gray-400">UGIS</span>
          </div>
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
            className="relative p-1.5 -mr-1.5 text-gray-300 hover:text-white transition-colors"
          >
            <span className="text-lg leading-none">{menuOpen ? '✕' : '☰'}</span>
            {!menuOpen && openCount > 0 && (
              <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-red-500" />
            )}
          </button>
        </div>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setMenuOpen(false)} />
            <nav className="absolute top-full left-0 right-0 z-40 bg-surface-1 border-b border-border shadow-lg max-h-[calc(100vh-3.25rem)] overflow-y-auto">
              <div className="px-2 py-2 space-y-0.5">
                {nav.map(({ to, label, icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded text-sm transition-colors ${
                        isActive
                          ? 'bg-surface-3 text-white'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-surface-2'
                      }`
                    }
                  >
                    <span className="text-xs">{icon}</span>
                    <span className="flex-1">{label}</span>
                    {to === '/actionable' && openCount > 0 && (
                      <span className="text-[10px] font-semibold bg-red-500/20 text-red-400 rounded-full px-1.5 py-0.5 leading-none">
                        {openCount}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
              <div className="px-2 py-2 border-t border-border">
                <div className="px-3 py-1.5 text-xs text-gray-600 truncate">{session?.user?.email}</div>
                <button
                  onClick={() => { setMenuOpen(false); void handleSignOut() }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-white hover:bg-surface-2 rounded transition-colors"
                >
                  Sign out
                </button>
              </div>
            </nav>
          </>
        )}
      </div>

      {/* Nightly (or manually triggered) discrepancy check indicator — shown
          on every page while a reconciliation run is in flight, since it can
          make Shopify-linked writes slower/queued for the duration. */}
      {latestRun?.status === 'running' && (
        <div className="shrink-0 bg-amber-500/15 text-amber-400 text-xs px-4 py-1.5 border-b border-amber-500/30 flex items-center justify-center gap-2">
          <Spinner size="sm" />
          Shopify discrepancy check running — some operations may be slower or delayed.
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — desktop */}
        <aside className="hidden md:flex flex-col w-52 bg-surface-1 border-r border-border shrink-0">
          <div className="px-5 py-4 border-b border-border flex items-center gap-3">
            <img src={logo} alt="Upstairs Garments" className="h-9 w-auto" />
            <span className="text-xs font-mono font-medium tracking-widest text-gray-500 uppercase">UGIS</span>
          </div>
          <nav className="flex-1 px-2 py-3 space-y-0.5">
            {nav.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors ${
                    isActive
                      ? 'bg-surface-3 text-white'
                      : 'text-gray-500 hover:text-gray-200 hover:bg-surface-2'
                  }`
                }
              >
                <span className="text-xs">{icon}</span>
                <span className="flex-1">{label}</span>
                {to === '/actionable' && openCount > 0 && (
                  <span className="text-[10px] font-semibold bg-red-500/20 text-red-400 rounded-full px-1.5 py-0.5 leading-none">
                    {openCount}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="px-2 py-3 border-t border-border">
            <div className="px-3 py-1.5 text-xs text-gray-600 truncate">{session?.user?.email}</div>
            <button onClick={handleSignOut} className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-white hover:bg-surface-2 rounded transition-colors">
              Sign out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto flex flex-col">
          {children}
        </main>
      </div>
    </div>
  )
}
