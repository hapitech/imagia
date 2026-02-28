import { UserProfile } from '@clerk/clerk-react';

export default function Settings() {
  return (
    <div className="mx-auto max-w-4xl py-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Settings</h1>
      <UserProfile
        appearance={{
          elements: {
            rootBox: 'w-full',
            card: 'shadow-none border border-gray-200 rounded-xl',
          },
        }}
      />
    </div>
  );
}
