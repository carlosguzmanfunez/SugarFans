import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Landing from './pages/Landing';
import AgeVerification from './pages/AgeVerification';
import Login from './pages/Login';
import Register from './pages/Register';
import Explore from './pages/Explore';
import PlatformSync from './components/PlatformSync';
import { openedFromRecoveryLink } from './lib/backend';

// Less visited pages load on demand, so the first visit downloads less.
const CreatorProfile = lazy(() => import('./pages/CreatorProfile'));
const ReferralLink = lazy(() => import('./pages/ReferralLink'));
const CreatorDashboard = lazy(() => import('./pages/CreatorDashboard'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const Help = lazy(() => import('./pages/Help'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const VIPExperiences = lazy(() => import('./pages/VIPExperiences'));
const LegalPolicies = lazy(() => import('./pages/LegalPolicies'));
const LiveRoom = lazy(() => import('./pages/LiveRoom'));
const LiveBroadcast = lazy(() => import('./pages/LiveBroadcast'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));

const LoadingScreen: React.FC = () => (
  <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Cargando">
    <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin"></div>
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode; roles?: string[] }> = ({ children, roles }) => {
  const { isAuthenticated, user, ageVerified, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  // Remember where the user was going so they land there after the check.
  if (!ageVerified) return <Navigate to="/age-verification" replace state={{ from: location.pathname }} />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/explore" replace />;
  
  return <>{children}</>;
};

// Login/register are pointless once signed in.
const GuestOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/explore" replace />;
  return <>{children}</>;
};

const AppLayout: React.FC<{ children: React.ReactNode; hideNav?: boolean }> = ({ children, hideNav }) => {
  return (
    <div className="flex flex-col min-h-screen">
      {!hideNav && <Navbar />}
      <main className="flex-1">{children}</main>
      {!hideNav && <Footer />}
    </div>
  );
};

// The "new password" email link may land on any page: take the user to the form.
const RecoveryRedirect: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    if (openedFromRecoveryLink && window.location.pathname !== '/reset-password') navigate('/reset-password', { replace: true });
  }, [navigate]);
  return null;
};

// A Google/Microsoft sign-up isn't usable until it picks fan or creator and
// accepts the terms: keep it on that step wherever it lands.
const PendingSignupRedirect: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  if (user?.signupCompleted === false && !['/auth/callback', '/legal', '/policies'].includes(location.pathname)) {
    return <Navigate to="/auth/callback" replace />;
  }
  return null;
};

const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<LoadingScreen />}>
    <RecoveryRedirect />
    <PendingSignupRedirect />
    <Routes>
      {/* Age Verification */}
      <Route path="/age-verification" element={
        <AppLayout hideNav={true}><AgeVerification /></AppLayout>
      } />
      
      {/* Auth pages (no footer) */}
      <Route path="/login" element={
        <AppLayout hideNav={true}><GuestOnlyRoute><Login /></GuestOnlyRoute></AppLayout>
      } />
      <Route path="/register" element={
        <AppLayout hideNav={true}><GuestOnlyRoute><Register /></GuestOnlyRoute></AppLayout>
      } />
      <Route path="/forgot-password" element={
        <AppLayout hideNav={true}><GuestOnlyRoute><ForgotPassword /></GuestOnlyRoute></AppLayout>
      } />
      {/* Return from Google/Microsoft (signs in, or finishes a new account). */}
      <Route path="/auth/callback" element={
        <AppLayout hideNav={true}><AuthCallback /></AppLayout>
      } />
      {/* Not guest-only: the emailed link signs the user in to change the password. */}
      <Route path="/reset-password" element={
        <AppLayout hideNav={true}><ResetPassword /></AppLayout>
      } />

      {/* Public pages */}
      <Route path="/" element={
        <AppLayout><Landing /></AppLayout>
      } />
      <Route path="/explore" element={
        <AppLayout><Explore /></AppLayout>
      } />
      <Route path="/creator/:id" element={
        <AppLayout><CreatorProfile /></AppLayout>
      } />
      <Route path="/reserve" element={
        <AppLayout><VIPExperiences /></AppLayout>
      } />
      <Route path="/vip-experiences" element={
        <AppLayout><VIPExperiences /></AppLayout>
      } />
      <Route path="/r/:id" element={<ReferralLink />} />
      <Route path="/pricing" element={<Navigate to="/register?role=creator" replace />} />
      <Route path="/help" element={
        <AppLayout><Help /></AppLayout>
      } />
      {/* The old summary page: /legal holds the current documents. */}
      <Route path="/policies" element={<Navigate to="/legal" replace />} />
      <Route path="/legal" element={
        <AppLayout><LegalPolicies /></AppLayout>
      } />

      {/* Protected pages */}
      <Route path="/live/:bookingId" element={
        <AppLayout>
          <ProtectedRoute><LiveRoom /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/en-vivo/:creatorId" element={
        <AppLayout>
          <ProtectedRoute><LiveBroadcast /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/profile" element={
        <AppLayout>
          <ProtectedRoute><Profile /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/settings" element={
        <AppLayout>
          <ProtectedRoute><Settings /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/creator/dashboard" element={
        <AppLayout>
          <ProtectedRoute roles={['creator', 'admin']}><CreatorDashboard /></ProtectedRoute>
        </AppLayout>
      } />
      <Route path="/admin" element={
        <AppLayout>
          <ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>
        </AppLayout>
      } />

      {/* 404 */}
      <Route path="*" element={
        <AppLayout>
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
              <p className="text-gray-600 mb-6">Página no encontrada</p>
              <Link to="/" className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium">
                Volver al inicio
              </Link>
            </div>
          </div>
        </AppLayout>
      } />
    </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <Router>
      <LanguageProvider>
        <AuthProvider>
          <PlatformSync />
          <AppRoutes />
        </AuthProvider>
      </LanguageProvider>
    </Router>
  );
}

export default App;
