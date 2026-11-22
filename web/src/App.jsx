import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { PageLoader } from "./components/Spinners.jsx";
import Home from "./pages/Home.jsx";

const Rounds = lazy(() => import("./pages/Rounds.jsx"));
const RoundDetail = lazy(() => import("./pages/RoundDetail.jsx"));
const Create = lazy(() => import("./pages/Create.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Ledger = lazy(() => import("./pages/Ledger.jsx"));
const Docs = lazy(() => import("./pages/Docs.jsx"));
const Demo = lazy(() => import("./pages/Demo.jsx"));
const NotFound = lazy(() => import("./pages/NotFound.jsx"));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!window.location.hash.includes("/docs/")) window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <Layout>
      <ScrollTop />
      <Suspense fallback={<PageLoader label="Loading page…" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/rounds" element={<Rounds />} />
          <Route path="/round/:id" element={<RoundDetail />} />
          <Route path="/create" element={<Create />} />
          <Route path="/me" element={<Dashboard />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:section" element={<Docs />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
