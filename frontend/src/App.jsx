import { Navigate, Route, Routes } from "react-router";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import CollectionPage from "./pages/CollectionPage";
import RecordPage from "./pages/RecordPage";
import ProfilePage from "./pages/ProfilePage";
import CreatePage from "./pages/CreatePage";
import EditRecordPage from "./pages/EditRecordPage";
import LoginPage from "./pages/LoginPage";
import RequireSignIn from "./components/RequireSignIn";
import useAuthReq from "../hooks/useAuthReq";
import {
  Show,
  SignUpButton,
  SignInButton,
  SignOutButton,
  UserButton,
  useUser,
} from "@clerk/react";

import SearchPage from "./pages/SearchPage";

function App() {
  useAuthReq();

  return (
    <div className="min-h-screen bg-base-100">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-8" >
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/collections" element={<CollectionPage />} />
        <Route path="/record/:id" element={<RecordPage />} />
        <Route path="/profile" element={isSignedIn ? <ProfilePage/> : <Navigate to={"/"} /> }/>
        <Route path="/create" element={isSignedIn ? <CreatePage/> : <Navigate to={"/"} /> }/>
        <Route path="/edit" element={isSignedIn ? <EditRecordPage/> : <Navigate to={"/"} /> }/>
        <Route path="/search" element={<SearchPage />} />
      </Routes>
      </main>
    </div>
  );
}

export default App;
