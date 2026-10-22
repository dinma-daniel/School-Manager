import type { Metadata } from "next";
import { CalendarView } from "@/components/CalendarView";

export const metadata: Metadata = {
  title: "Calendar · Application Planner",
};

export default function CalendarPage() {
  return <CalendarView />;
}
