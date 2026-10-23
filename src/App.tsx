import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useProfile } from './hooks/useProfile'
import Login from './pages/Login'
import Inventory from './pages/Inventory'
import Brands from './pages/Brands'
import Consignees from './pages/Consignees'
import Import from './pages/Import'
import Logs from './pages/Logs'
import Statistics from './pages/Statistics'
import ShopifyLink from './pages/ShopifyLink'
import Actionable from './pages/Actionable'
import Spinner from './components/ui/Spinner'

interface ProtectedProps {
  children: React.ReactNode
}

function Protected({ children }: ProtectedProps) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

// Wraps Protected for routes that only make sense for Upstairs Garments
// staff (Shopify integration, cross-consignee admin) — consignee accounts
// get redirected home rather than seeing a broken/empty page. This is a
// convenience redirect only; the real boundary is RLS + the requireStaff
// edge function guard (see 012_consignee_accounts.sql), since a consignee
// could otherwise reach these routes directly by URL.
function StaffOnly({ children }: ProtectedProps) {
  const { profile, loading } = useProfile()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }
  if (profile.role !== 'staff') return <Navigate to="/" replace />
  return <Protected>{children}</Protected>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Inventory /></Protected>} />
        <Route path="/brands" element={<Protected><Brands /></Protected>} />
        <Route path="/import" element={<Protected><Import /></Protected>} />
        <Route path="/shopify" element={<StaffOnly><ShopifyLink /></StaffOnly>} />
        <Route path="/actionable" element={<Protected><Actionable /></Protected>} />
        <Route path="/consignees" element={<StaffOnly><Consignees /></StaffOnly>} />
        <Route path="/logs" element={<Protected><Logs /></Protected>} />
        <Route path="/statistics" element={<Protected><Statistics /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
