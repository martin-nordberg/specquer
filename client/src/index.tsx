import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <h1 className="text-3xl font-bold text-red-600">Specquer</h1>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
