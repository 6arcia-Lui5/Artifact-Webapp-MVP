import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { ClerkProvider } from "@clerk/react";
import { BrowserRouter } from "react-router";
import SessionQueryProvider from "./components/SessionQueryProvider";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ClerkProvider signInUrl="/login" signUpUrl="/signup" afterSignOutUrl="/">
      <BrowserRouter>
        <SessionQueryProvider><App /></SessionQueryProvider>
      </BrowserRouter>
    </ClerkProvider>
  </StrictMode>,
);
