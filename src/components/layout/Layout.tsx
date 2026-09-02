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

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-40 bg-surface-1 border-b border-border flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <img src={logo} alt="Upstairs Garments" className="h-5 w-auto" />
          <span className="text-xs font-mono font-medium tracking-widest text-gray-400">UGIS</span>
        </div>
        <nav className="flex items-center gap-1">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-2 py-1 rounded text-xs transition-colors ${
                  isActive ? 'bg-surface-3 text-white' : 'text-gray-500'
                }`
              }
            >
              {label}{to === '/actionable' && openCount > 0 ? ` (${openCount})` : ''}
            </NavLink>
          ))}
        </nav>
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
