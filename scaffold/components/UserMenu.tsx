'use client';

/**
 * UserMenu.tsx — avatar, name, and log out. Drop into your header.
 *
 *   <header className="flex items-center justify-between ...">
 *     <Logo />
 *     <UserMenu />
 *   </header>
 */

import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export function UserMenu() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  if (loading || !user) return null;

  const handleSignOut = () => {
    signOut();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-[44px] items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- external avatar; referrerPolicy avoids Google's 403 on lh3.googleusercontent.com */}
      {/* Subtle neutral image outline (pure black/white alpha, never a tinted
          near-black) gives the avatar consistent edge depth in both themes. */}
      <img
        src={user.avatarUrl}
        alt=""
        width={32}
        height={32}
        referrerPolicy="no-referrer"
        className="rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      />
      <span className="hidden text-sm font-medium text-foreground sm:inline">
        {user.name}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        className="inline-flex min-h-[44px] items-center rounded-md px-3 py-1.5 text-sm font-medium text-structure-on-canvas transition hover:bg-canvas-alt active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-structure-on-canvas focus-visible:ring-offset-2"
      >
        Log out
      </button>
    </div>
  );
}
