import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ToastProvider } from "./components/ui/Toast.jsx";
import { companyConfig } from "../companyConfig.js";
import { applyBrand } from "./lib/brand.js";
import { startPublicQuotePrefetch } from "./lib/publicPrefetch.js";
import "./index.css";

applyBrand(companyConfig);
startPublicQuotePrefetch(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
