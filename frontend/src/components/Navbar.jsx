import { Link } from 'react-router';
import { SignInButton, SignUpButton, UserButton, useAuth, Show, SignOutButton, SignIn } from '@clerk/react';
import { MapIcon, DraftingCompassIcon, PlusIcon, UserIcon, Search } from 'lucide-react';

function Navbar() {
  const { isSignedIn } = useAuth();

  return <div className='navbar bg-purple-950 pb-0'>
          <div className='max-w-10xl mx-auto w-full px-4 flex justify-between items-center text-secondary'>
            {/* LOGO - LEFT SIDE */}
            <div className='flex-1'>
              <Link to="/" className="btn btn-ghost gap-2">
                <DraftingCompassIcon className='size-5 text-primary'/>
                <span className='text-lg font-bold font-serif uppercase -tracking-tight'>The Artifact Site</span>
              </Link>
              <div className='flex gap-6 pb-1 pt-2'>
                <div className='relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:w-0 after:bg-white after:transition-all after:duration-300 hover:after:w-full'>About</div>
                <div className='relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:w-0 after:bg-white after:transition-all after:duration-300 hover:after:w-full'>Collections</div>
                <div className='relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:w-0 after:bg-white after:transition-all after:duration-300 hover:after:w-full'>Research</div>
              </div>
            </div>

            <div className='flex gap-2 items-center text-secondary'>
              {isSignedIn ? (
                <>
                  <Link to="/search" className='btn btn-ghost btn-sm gap-1'>
                    <Search className='size-4'/>
                    <span className='hidden sm:inline'>Search</span>
                  </Link>
                  <Link to="/create" className='btn btn-primary btn-sm gap-1'>
                    <PlusIcon className='size-4'/>
                    <span className='hidden sm:inline'>New Record</span>
                  </Link>
                  <Link to="/profile" className='btn btn-ghost btn-sm gap-1'>
                    <UserIcon className='size-4'/>
                    <span className='hidden sm:inline'>Profile</span>
                  </Link>
                  <UserButton />
                </>
              ) : (
                <>
                  <SignInButton mode="modal">
                    <button className='btn btn-ghost btn-sm'>Sign In</button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button className='btn btn-primary btn-sm'>Sign Up</button>
                  </SignUpButton>
                </>
              )}

            </div>
          </div>
      </div>
}

export default Navbar