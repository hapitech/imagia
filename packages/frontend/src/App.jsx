import { Routes, Route } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import ProjectBuilder from './pages/ProjectBuilder';
import MarketingStudio from './pages/MarketingStudio';
import SocialHub from './pages/SocialHub';
import PromptHistory from './pages/PromptHistory';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import SignInPage from './pages/SignIn';
import SignUpPage from './pages/SignUp';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import LandingPage from './pages/LandingPage';
import AdminWaitlist from './pages/AdminWaitlist';

function ProtectedRoute({ children }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

function HomeRoute() {
  return (
    <>
      <SignedIn>
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      </SignedIn>
      <SignedOut>
        <LandingPage />
      </SignedOut>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />

      <Route path="/" element={<HomeRoute />}>
        <Route index element={<Dashboard />} />
        <Route path="project/:id" element={<ProjectBuilder />} />
        <Route path="project/:id/marketing" element={<MarketingStudio />} />
        <Route path="social" element={<SocialHub />} />
        <Route path="prompts" element={<PromptHistory />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin/waitlist" element={<AdminWaitlist />} />
      </Route>
    </Routes>
  );
}
