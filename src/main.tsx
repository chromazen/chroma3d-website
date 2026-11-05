import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./App";
import "./styles.css";
import "./design.css";
const root = document.getElementById("root")!;
const app = (
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App initialPath={root.dataset.path} />
    </MotionConfig>
  </React.StrictMode>
);
if (root.dataset.path) ReactDOM.hydrateRoot(root, app);
else ReactDOM.createRoot(root).render(app);
