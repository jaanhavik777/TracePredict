import "./globals.css";
import type { ReactNode } from "react";
import NavBar from "@/components/incident/NavBar";

export const metadata = {
  title: "TracePredict",
  description: "Incident triage, investigation and resolution intelligence",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
