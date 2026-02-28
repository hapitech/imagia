import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * This page receives the GitHub OAuth callback redirect.
 * It extracts the authorization code from the URL and sends it
 * back to the opener window via postMessage (+ localStorage fallback),
 * then closes itself.
 */
export default function GitHubCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('processing');
  const [showManualClose, setShowManualClose] = useState(false);

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      if (window.opener) {
        window.opener.postMessage({ type: 'github-oauth', error }, window.location.origin);
      }
      // localStorage fallback
      try { localStorage.setItem('github-oauth-error', error); } catch {}
      return;
    }

    if (code) {
      setStatus('success');
      let sent = false;

      // Primary: postMessage to parent
      if (window.opener) {
        window.opener.postMessage({ type: 'github-oauth', code }, window.location.origin);
        sent = true;
      }

      // Fallback: localStorage (parent listens for storage event)
      try { localStorage.setItem('github-oauth-code', code); } catch {}

      // Auto-close after a longer delay to ensure message delivery
      setTimeout(() => {
        try { window.close(); } catch {}
      }, 1500);

      // Show manual close button after 2s in case auto-close fails
      setTimeout(() => setShowManualClose(true), 2000);
    } else {
      setStatus('error');
    }
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        {status === 'processing' && (
          <>
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-gray-600">Connecting GitHub...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <svg className="mx-auto mb-4 h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm text-gray-600">GitHub connected! This window will close automatically.</p>
            {showManualClose && (
              <button
                onClick={() => window.close()}
                className="mt-4 rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
              >
                Close this window
              </button>
            )}
          </>
        )}
        {status === 'error' && (
          <>
            <svg className="mx-auto mb-4 h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <p className="text-sm text-gray-600">GitHub connection failed. You can close this window.</p>
            <button
              onClick={() => window.close()}
              className="mt-4 rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
            >
              Close this window
            </button>
          </>
        )}
      </div>
    </div>
  );
}
