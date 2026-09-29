import { useState } from "react";
import { useAuth } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function SessionCache({ children }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export default function SessionQueryProvider({ children }) {
  const { userId } = useAuth();
  return <SessionCache key={userId || "guest"}>{children}</SessionCache>;
}

