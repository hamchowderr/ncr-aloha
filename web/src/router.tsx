import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import { AdminLayout } from "./layouts/AdminLayout";
import { DashboardPage } from "./pages/admin/DashboardPage";
import { SitesPage } from "./pages/admin/SitesPage";
import { MenuPage } from "./pages/admin/MenuPage";
import { OrdersPage } from "./pages/admin/OrdersPage";
import { OrderDetailPage } from "./pages/admin/OrderDetailPage";
import { CallsPage } from "./pages/admin/CallsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: "sites",
        element: <SitesPage />,
      },
      {
        path: "menu",
        element: <MenuPage />,
      },
      {
        path: "orders",
        element: <OrdersPage />,
      },
      {
        path: "orders/:orderId",
        element: <OrderDetailPage />,
      },
      {
        path: "calls",
        element: <CallsPage />,
      },
    ],
  },
]);
