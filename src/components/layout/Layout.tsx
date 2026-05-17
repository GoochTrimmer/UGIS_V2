import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

const nav = [
  { to: '/',           label: 'Inventory',  icon: '▦' },
  { to: '/brands',     label: 'Brands',     icon: '◈' },
  { to: '/consignees', label: 'Consignees', icon: '◎' },
  { to: '/import',     label: 'Import',     icon: '↑' },
]

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { signOut, session } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-52 bg-surface-1 border-r border-border shrink-0">
        <div className="px-5 py-5 border-b border-border">
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
              {label}
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

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 bg-surface-1 border-b border-border flex items-center justify-between px-4 py-3">
        <span className="text-xs font-mono font-medium tracking-widest text-gray-400">UGIS</span>
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
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto md:pt-0 pt-12 flex flex-col">
        {children}
      </main>
    </div>
  )
}
