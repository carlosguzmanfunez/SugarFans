import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Landing from './pages/Landing';
import AgeVerification from './pages/AgeVerification';
import Login from './pages/Login';
import Register from './pages/Register';
import Explore from './pages/Explore';
import CreatorProfile from './pages/CreatorProfile';
import CreatorDashboard from './pages/CreatorDashboard';
import AdminDashboard from './pages/AdminDashboard';
import Pricing from './pages/Pricing';
import Help from './pages/Help';
import Policies from './pages/Policies';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import VIPExperiences from './pages/VIPExperiences';
import LegalPolicies from './pages/LegalPolicies';
import PlatformSync from './components/PlatformSync';

const ProtectedRoute: React.FC<{ children: React.ReactNode; roles?: string[] }> = ({ children, roles }) => {
  const { isAuthenticated, user, ageVerified } = useAuth();
  const location = useLocation();

  // Remember where the user was going so they land there after the check.
  if (!ageVerified) return <Navigate to="/age-verification" replace state={{ from: location.pathname }} />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/explore" replace />;
  
  return <>{children}</>;
};

// Login/register are pointless once signed in.
const GuestOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
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

const AppRoutes: React.FC = () => {
  return (
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
      <Route path="/vip-experiences" element={
        <AppLayout><VIPExperiences /></AppLayout>
      } />
      <Route path="/pricing" element={
        <AppLayout><Pricing /></AppLayout>
      } />
      <Route path="/help" element={
        <AppLayout><Help /></AppLayout>
      } />
      <Route path="/policies" element={
        <AppLayout><Policies /></AppLayout>
      } />
      <Route path="/legal" element={
        <AppLayout><LegalPolicies /></AppLayout>
      } />

      {/* Protected pages */}
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
