import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { httpApi } from "@/lib/api";
import { installFavicon } from "@/theme/logo";
import { installPalette } from "@/theme/theme";

installPalette();
installFavicon();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={httpApi} />
  </StrictMode>,
);
