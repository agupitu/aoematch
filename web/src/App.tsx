import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { Avatar } from './components/ui';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { CreateTournament } from './pages/CreateTournament';
import { TournamentPage } from './pages/TournamentPage';
import { MatchRoom } from './pages/MatchRoom';

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm transition-colors ${
      isActive ? 'bg-ink-800 text-gold-400' : 'text-parch-200 hover:text-gold-400'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
        <Link to="/" className="title flex items-center gap-2 text-lg text-gold-400">
          <img src="/assets/flags/Flag_Random.webp" alt="" className="h-6 w-9 rounded-[3px] object-cover" />
          AOEMatch
        </Link>
        <nav className="ml-4 flex items-center gap-1">
          <NavLink to="/" end className={link}>
            Torneos
          </NavLink>
          {user && (
            <NavLink to="/crear" className={link}>
              Crear torneo
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link to="/perfil" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-ink-800">
                <Avatar src={user.avatar_url} name={user.display_name} />
                <span className="text-sm text-parch-200">{user.display_name}</span>
              </Link>
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
              >
                Salir
              </button>
            </>
          ) : (
            <Link to="/entrar" className="btn btn-primary">
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function App() {
  return (
    <div className="flex min-h-full flex-col">
      <Nav />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/entrar" element={<Login />} />
          <Route path="/perfil" element={<Profile />} />
          <Route path="/crear" element={<CreateTournament />} />
          <Route path="/t/:slug" element={<TournamentPage />} />
          <Route path="/m/:id" element={<MatchRoom />} />
          <Route
            path="*"
            element={<p className="mx-auto max-w-7xl p-10 text-center text-parch-400">Esta página no existe.</p>}
          />
        </Routes>
      </main>
    </div>
  );
}
