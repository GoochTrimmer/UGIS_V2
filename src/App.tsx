import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Inventory from './pages/Inventory'
import Brands from './pages/Brands'
import Consignees from './pages/Consignees'
import Import from './pages/Import'
import Logs from './pages/Logs'
import Statistics from './pages/Statistics'
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Inventory /></Protected>} />
        <Route path="/brands" element={<Protected><Brands /></Protected>} />
        <Route path="/consignees" element={<Protected><Consignees /></Protected>} />
        <Route path="/import" element={<Protected><Import /></Protected>} />
        <Route path="/logs" element={<Protected><Logs /></Protected>} />
        <Route path="/statistics" element={<Protected><Statistics /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
