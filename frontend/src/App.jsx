import { Navigate, Route, Routes } from "react-router";
import HomePage from "./pages/HomePage";
import CollectionPage from "./pages/CollectionPage";
import RecordPage from "./pages/RecordPage";
import ProfilePage from "./pages/ProfilePage";
import CreatePage from "./pages/CreatePage";
import EditRecordPage from "./pages/EditRecordPage";
import LoginPage from "./pages/LoginPage";
import SearchPage from "./pages/SearchPage";
import RequireSignIn from "./components/RequireSignIn";
import RequireSiteAccess from "./components/RequireSiteAccess";
import useAuthReq from "../hooks/useAuthReq";

function App() {
  useAuthReq();

  return (
    <Routes>
      <Route path="/login/*" element={<LoginPage />} />
      {import.meta.env.DEV && <Route path="/signup/*" element={<LoginPage mode="signup" />} />}
      <Route element={<RequireSiteAccess />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/collections" element={<CollectionPage />} />
        <Route path="/record/:id" element={<RecordPage />} />
        <Route path="/search" element={<SearchPage />} />
        {!import.meta.env.DEV && (
          <Route path="/signup/*" element={
            <p>Account creation is available only in the local development environment.</p>
          } />
        )}
        <Route element={<RequireSignIn />}>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/edit/:id" element={<EditRecordPage />} />
          <Route path="/edit" element={<EditRecordPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
