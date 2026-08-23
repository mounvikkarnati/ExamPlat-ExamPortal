import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Gate for pages that require a logged-in (verified) candidate. */
export default function ProtectedRoute({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}