// import { Navigate, Route, Routes } from "react-router";
// import Navbar from "./components/Navbar";
// import HomePage from "./pages/HomePage";
// import CollectionPage from "./pages/CollectionPage";
// import RecordPage from "./pages/RecordPage";
// import ProfilePage from "./pages/ProfilePage";
// import CreatePage from "./pages/CreatePage";
// import EditRecordPage from "./pages/EditRecordPage";
// import LoginPage from "./pages/LoginPage";
// import RequireSignIn from "./components/RequireSignIn";
// import useAuthReq from "../hooks/useAuthReq"
// import useUserSync from "../hooks/useUserSync";

// import SearchPage from "./pages/SearchPage";

// function App() {
//   const { isClerkLoaded, isSignedIn} = useAuthReq();
//   useUserSync();
//   if (!isClerkLoaded) return null;

//   return (
//     <div className="min-h-screen bg-base-100">
//       <Navbar />
//       <main className="max-w-5xl mx-auto px-4 py-8" >
//       <Routes>
//         <Route path="/" element={<HomePage />} />
//         <Route path="/collections" element={<CollectionPage />} />
//         <Route path="/record/:id" element={<RecordPage />} />
//         <Route path="/login/*" element={<LoginPage />} />
//           <Route path="/signup/*" element={<LoginPage mode="signup" />} />
//           <Route element={<RequireSignIn />}></Route>
//         <Route path="/profile" element={isSignedIn ? <ProfilePage/> : <Navigate to={"/"} /> }/>
//         <Route path="/create" element={isSignedIn ? <CreatePage/> : <Navigate to={"/"} /> }/>
//         <Route path="/edit/:id" element={<EditRecordPage />} />
//         <Route path="/edit" element={isSignedIn ? <EditRecordPage/> : <Navigate to={"/"} /> }/>
//         <Route path="/search" element={<SearchPage />} />
//       </Routes>
//       </main>
//     </div>
//   );
// }

// export default App;

//Temporary Login (For Halle and Authorized users)
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
import AppLayout from "./components/AppLayout";

function App() {
  return (
    <Routes>

      {/* Public */}
      <Route path="/login/*" element={<LoginPage />} />
      <Route path="/signup/*" element={<LoginPage mode="signup" />} />

      {/* Everything below requires authentication */}
      <Route element={<RequireSignIn />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/collections" element={<CollectionPage />} />
          <Route path="/record/:id" element={<RecordPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/edit/:id" element={<EditRecordPage />} />
          <Route path="/edit" element={<EditRecordPage />} />
          <Route path="/search" element={<SearchPage />} />
        </Route>
      </Route>

      {/* Unknown routes */}
      <Route path="*" element={<Navigate to="/" replace />} />

    </Routes>
  );
}

export default App;
