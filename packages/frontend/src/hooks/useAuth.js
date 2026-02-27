import { useEffect } from 'react';
import { useAuth as useClerkAuth, useUser } from '@clerk/clerk-react';
import { setTokenGetter } from '../services/api';

export default function useAuth() {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user } = useUser();

  // Wire up the API service with the token getter once on mount
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setTokenGetter(getToken);
    }
  }, [isLoaded, isSignedIn, getToken]);

  return {
    user,
    isLoaded,
    isSignedIn,
    getToken,
  };
}
