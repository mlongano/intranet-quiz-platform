import { useEffect, useRef, useState } from 'react';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;

/** Google's "Sign in with Google" button; calls onCredential with the ID token. */
function GoogleSignInButton({ onCredential, onError }: {
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.google);
  // The latest callbacks, without re-rendering Google's button on each render.
  const callbacks = useRef({ onCredential, onError });
  useEffect(() => { callbacks.current = { onCredential, onError }; }, [onCredential, onError]);

  // The script loads asynchronously (index.html): wait for it.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || ready) return;
    const timer = window.setInterval(() => {
      if (window.google) { setReady(true); window.clearInterval(timer); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !ready || !ref.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (response.credential) callbacks.current.onCredential(response.credential);
        else callbacks.current.onError('Accesso Google non riuscito.');
      },
    });
    ref.current.innerHTML = '';
    window.google.accounts.id.renderButton(ref.current, {
      theme: 'outline', size: 'large', width: 300, text: 'signin_with',
    });
  }, [ready]);

  if (!GOOGLE_CLIENT_ID) {
    return <p className="text-sm text-error">Accesso Google non configurato: avvisa il tuo docente.</p>;
  }
  return <div ref={ref} className="flex justify-center min-h-11" />;
}

export default GoogleSignInButton;
