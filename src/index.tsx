import { AppUiProvider } from "@canva/app-ui-kit";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "@canva/app-ui-kit/styles.css";
import { AppI18nProvider } from "@canva/app-i18n-kit";
import { prepareDesignEditor } from "@canva/intents/design";

const root = createRoot(document.getElementById("root") as Element);

prepareDesignEditor({
  render: async () => {
    root.render(
      <AppI18nProvider>
        <AppUiProvider>
          <App />
        </AppUiProvider>
      </AppI18nProvider>,
    );
  },
});

if (module.hot) {
  module.hot.accept("./app", () => {
    root.render(
      <AppI18nProvider>
        <AppUiProvider>
          <App />
        </AppUiProvider>
      </AppI18nProvider>,
    );
  });
}
