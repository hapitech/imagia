import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-gray-900">Imagia</Link>
          <div className="flex gap-4 text-sm">
            <Link to="/terms" className="text-gray-600 hover:text-gray-900">Terms of Service</Link>
            <Link to="/sign-in" className="text-indigo-600 hover:text-indigo-700 font-medium">Sign In</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: February 28, 2026</p>

        <div className="prose prose-gray max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">1. Introduction</h2>
            <p className="text-gray-700 leading-relaxed">
              Imagia ("we", "our", or "us") operates the imagia.net website and platform. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our service. By using Imagia, you agree to the collection and use of information in accordance with this policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">2. Information We Collect</h2>
            <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Account Information</h3>
            <p className="text-gray-700 leading-relaxed">
              When you create an account, we collect information provided by your authentication provider (Google or GitHub), including your name, email address, and profile picture. Authentication is handled by Clerk, a third-party authentication service.
            </p>
            <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Project Data</h3>
            <p className="text-gray-700 leading-relaxed">
              We store the projects you create, including code files, conversation history, configuration data, and any media files you upload. This data is necessary to provide our AI-powered app building service.
            </p>
            <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Usage Data</h3>
            <p className="text-gray-700 leading-relaxed">
              We collect information about how you interact with our service, including pages visited, features used, API calls made, and LLM model usage. This helps us improve the platform and monitor costs.
            </p>
            <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Secrets and API Keys</h3>
            <p className="text-gray-700 leading-relaxed">
              If you provide API keys or secrets for your projects, they are encrypted using AES-256-GCM encryption before storage and are never sent to third-party LLM providers. You can delete your secrets at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 text-gray-700 space-y-2">
              <li>To provide, maintain, and improve our AI app building platform</li>
              <li>To process your requests and generate code, images, and marketing content</li>
              <li>To communicate with you about your account and our services</li>
              <li>To monitor usage patterns and optimize performance</li>
              <li>To detect and prevent fraud, abuse, or security issues</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">4. Third-Party Services</h2>
            <p className="text-gray-700 leading-relaxed">We use the following third-party services to operate our platform:</p>
            <ul className="list-disc pl-6 text-gray-700 space-y-2 mt-2">
              <li><strong>Clerk</strong> — Authentication and user management</li>
              <li><strong>Fireworks AI</strong> — AI model inference for code generation and image creation</li>
              <li><strong>OpenAI</strong> — AI model inference for content generation</li>
              <li><strong>Anthropic</strong> — AI model inference for code generation</li>
              <li><strong>Railway</strong> — Application hosting and infrastructure</li>
              <li><strong>GitHub</strong> — Source code integration (when connected by you)</li>
            </ul>
            <p className="text-gray-700 leading-relaxed mt-2">
              Each of these services has their own privacy policies. Your conversation messages are sent to AI providers to generate responses, but we do not share your personal account information with them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">5. Data Retention</h2>
            <p className="text-gray-700 leading-relaxed">
              We retain your data for as long as your account is active. You can delete individual projects at any time. If you wish to delete your account and all associated data, please contact us at the email below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">6. Data Security</h2>
            <p className="text-gray-700 leading-relaxed">
              We implement appropriate technical and organizational measures to protect your data, including encryption in transit (TLS) and at rest, encrypted secret storage (AES-256-GCM), and access controls. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">7. Your Rights</h2>
            <p className="text-gray-700 leading-relaxed">You have the right to:</p>
            <ul className="list-disc pl-6 text-gray-700 space-y-2 mt-2">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Export your project data</li>
              <li>Withdraw consent for optional data processing</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">8. Cookies</h2>
            <p className="text-gray-700 leading-relaxed">
              We use essential cookies for authentication and session management through Clerk. We do not use advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">9. Children's Privacy</h2>
            <p className="text-gray-700 leading-relaxed">
              Imagia is not intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">10. Changes to This Policy</h2>
            <p className="text-gray-700 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last updated" date at the top of this page. Continued use of the service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">11. Contact Us</h2>
            <p className="text-gray-700 leading-relaxed">
              If you have questions about this Privacy Policy, please contact us at <a href="mailto:privacy@imagia.net" className="text-indigo-600 hover:text-indigo-700">privacy@imagia.net</a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="mx-auto max-w-4xl px-6 py-6 flex items-center justify-between text-sm text-gray-500">
          <span>&copy; {new Date().getFullYear()} Imagia. All rights reserved.</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-gray-700">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-gray-700">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
