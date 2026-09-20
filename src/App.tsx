import { Route, Routes } from "react-router-dom";
import { SettingsProvider } from "./SettingsContext";
import Sidebar from "./components/Sidebar";
import MobileTopBar from "./components/MobileTopBar";
import PlansPage from "./pages/PlansPage";
import PlanDetailPage from "./pages/PlanDetailPage";
import WorkoutPage from "./pages/WorkoutPage";
import ActiveSessionPage from "./pages/ActiveSessionPage";
import HistoryPage from "./pages/HistoryPage";
import SessionDetailPage from "./pages/SessionDetailPage";
import StatsPage from "./pages/StatsPage";
import CalendarPage from "./pages/CalendarPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <SettingsProvider>
      <div className="flex h-full flex-col lg:flex-row">
        {/* Mobile: top bar + hamburger nav; desktop: fixed sidebar */}
        <div className="contents lg:hidden">
          <MobileTopBar />
        </div>
        <div className="hidden lg:block">
          <Sidebar />
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <Routes>
            <Route path="/" element={<PlansPage />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/plans/:id" element={<PlanDetailPage />} />
            <Route path="/workout" element={<WorkoutPage />} />
            <Route path="/workout/day/:dayId" element={<WorkoutPage />} />
            <Route path="/workout/session/:id" element={<ActiveSessionPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/history/:id" element={<SessionDetailPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </SettingsProvider>
  );
}
