import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationCenter } from "../../../src/components/notifications/NotificationCenter";
import { setAppPageActive } from "../../../src/lib/app-page-activity";
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
window.notificationFixture = { setActive: setAppPageActive };
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <NotificationCenter sessionKey="synthetic-user" />
  </QueryClientProvider>,
);
