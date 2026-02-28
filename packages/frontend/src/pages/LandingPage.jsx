import { useState } from 'react';
import { Link } from 'react-router-dom';
import { joinWaitlist } from '../services/api';
import ImagiaLogo from '../components/ImagiaLogo';

const features = [
  {
    title: 'AI Code Generation',
    description: 'Describe what you want and watch your app come to life with intelligent code generation.',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    title: 'Multi-Model LLM',
    description: 'Automatically routes to the best AI model for each task — Claude, GPT-4o, Llama, and more.',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a2.25 2.25 0 01-1.59.659H9.06a2.25 2.25 0 01-1.591-.659L5 14.5m14 0V5a2 2 0 00-2-2H7a2 2 0 00-2 2v9.5" />
      </svg>
    ),
  },
  {
    title: 'One-Click Deploy',
    description: 'Deploy to production with custom domains, SSL, and monitoring — all handled for you.',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
      </svg>
    ),
  },
  {
    title: 'GitHub Integration',
    description: 'Import repos, push changes, and keep your code in sync with full GitHub integration.',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.556a4.5 4.5 0 00-6.364-6.364L4.5 8.25a4.5 4.5 0 006.364 6.364l4.5-4.5z" />
      </svg>
    ),
  },
  {
    title: 'Marketing Suite',
    description: 'Generate landing pages, social posts, and marketing assets for your app automatically.',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
      </svg>
    ),
  },
  {
    title: 'Secret Management',
    description: 'Auto-detect API keys and secrets in your code with AES-256 encrypted secure storage.',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
];

const steps = [
  { num: '1', title: 'Describe your app', description: 'Tell Imagia what you want to build in plain English.' },
  { num: '2', title: 'AI builds it', description: 'Watch as AI generates your full-stack application in real-time.' },
  { num: '3', title: 'Deploy & share', description: 'One-click deploy to production with your own custom domain.' },
];

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [useCase, setUseCase] = useState('');
  const [status, setStatus] = useState('idle'); // idle, submitting, success, error
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email) return;

    setStatus('submitting');
    setErrorMsg('');

    try {
      await joinWaitlist({ email, name: name || undefined, use_case: useCase || undefined });
      setStatus('success');
      setEmail('');
      setName('');
      setUseCase('');
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong. Please try again.';
      setErrorMsg(msg);
      setStatus('error');
    }
  }

  function WaitlistForm({ id }) {
    if (status === 'success') {
      return (
        <div id={id} className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
          <svg className="mx-auto mb-3 h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-semibold text-green-800">You're on the list!</h3>
          <p className="mt-1 text-sm text-green-700">We'll let you know as soon as we're ready for you.</p>
        </div>
      );
    }

    return (
      <form id={id} onSubmit={handleSubmit} className="mx-auto max-w-md space-y-3">
        <div className="flex gap-3">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-36 rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <input
          type="text"
          placeholder="What do you want to build? (optional)"
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-700 hover:shadow-indigo-500/40 disabled:opacity-60"
        >
          {status === 'submitting' ? 'Joining...' : 'Join the Waitlist'}
        </button>
        {status === 'error' && (
          <p className="text-center text-sm text-red-600">{errorMsg}</p>
        )}
      </form>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 md:px-12">
        <span className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ImagiaLogo className="h-8 w-8" />
          <span><span className="text-indigo-600">Ima</span>gia</span>
        </span>
        <Link
          to="/sign-in"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Sign in
        </Link>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-20 pt-16 text-center md:pt-24">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          Early access coming soon
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
          Build apps with{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            conversation
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
          Imagia is an AI-powered app builder that lets you create, deploy, and manage web applications
          through a conversational interface. No boilerplate. No config. Just describe what you want.
        </p>
        <div className="mt-10">
          <WaitlistForm id="hero-form" />
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-gray-100 bg-gray-50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold text-gray-900">Everything you need to ship</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">
            From idea to production in one conversation. Imagia handles the stack so you can focus on the product.
          </p>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md">
                <div className="mb-4 inline-flex rounded-lg bg-indigo-50 p-2.5 text-indigo-600">
                  {f.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-3xl font-bold text-gray-900">How it works</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.num} className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-lg font-bold text-white">
                  {s.num}
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{s.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-gray-100 bg-gradient-to-br from-indigo-600 to-purple-700 px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white">Ready to build something?</h2>
          <p className="mt-3 text-indigo-100">
            Join the waitlist and be the first to try Imagia when we launch.
          </p>
          <div className="mt-8">
            <div className="[&_input]:border-indigo-400/30 [&_input]:bg-white/10 [&_input]:text-white [&_input]:placeholder-indigo-200 [&_input:focus]:border-white [&_input:focus]:ring-white/20 [&_button]:bg-white [&_button]:text-indigo-700 [&_button]:shadow-none hover:[&_button]:bg-indigo-50">
              <WaitlistForm id="bottom-form" />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
          <span className="text-sm text-gray-500">&copy; {new Date().getFullYear()} Imagia. All rights reserved.</span>
          <div className="flex gap-6">
            <Link to="/privacy" className="text-sm text-gray-500 hover:text-gray-700">Privacy</Link>
            <Link to="/terms" className="text-sm text-gray-500 hover:text-gray-700">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
