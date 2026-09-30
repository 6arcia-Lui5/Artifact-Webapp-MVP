import { Navigate, Route, Routes } from "react-router";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import CollectionPage from "./pages/CollectionPage";
import RecordPage from "./pages/RecordPage";
import ProfilePage from "./pages/ProfilePage";
import CreatePage from "./pages/CreatePage";
import EditRecordPage from "./pages/EditRecordPage";
import LoginPage from "./pages/LoginPage";
import SearchPage from "./pages/SearchPage";
import RequireSignIn from "./components/RequireSignIn";
import useAuthReq from "../hooks/useAuthReq";

function App() {
  useAuthReq();

  return (
    <div className="min-h-screen bg-base-100">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/collections" element={<CollectionPage />} />
          <Route path="/record/:id" element={<RecordPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/login/*" element={<LoginPage />} />
          <Route path="/signup/*" element={<LoginPage mode="signup" />} />
          <Route element={<RequireSignIn />}>
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/create" element={<CreatePage />} />
            <Route path="/edit/:id" element={<EditRecordPage />} />
            <Route path="/edit" element={<EditRecordPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
