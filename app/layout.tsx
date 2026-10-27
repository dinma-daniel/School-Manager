import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, JetBrains_Mono, Patrick_Hand } from "next/font/google";
import { AppNav } from "@/components/AppNav";
import "./globals.css";
import "./ui-styles.css";

/*
 * Which visual style to render. Pleurat is the default. The original look
 * is still available on its own dev server (`dev:classic` in package.json).
 * Read at build time, so a server shows one style for its whole life.
 */
type Ui = "classic" | "pleurat";
const UI: Ui = process.env.NEXT_PUBLIC_UI === "classic" ? "classic" : "pleurat";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const hand = Patrick_Hand({ subsets: ["latin"], weight: "400", variable: "--font-hand", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

const FONTS: Record<Ui, string> = {
  classic: `${inter.variable} ${jetbrains.variable} ${hand.variable}`,
  // General Sans isn't on Google Fonts; it comes from Fontshare in the head below.
  pleurat: `${plexMono.variable} ${hand.variable}`,
};

export const metadata: Metadata = {
  title: "Application Planner",
  description: "Paste a university link and get the application, the deadlines and the money in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-ui={UI} suppressHydrationWarning>
      <head>
        {/*
          Blocking, and as early as the head allows: this sets data-theme from
          the stored preference before anything paints, so a dark-mode reader
          never gets a white flash on load. With nothing stored it's light,
          whatever the OS prefers. Inline rather than a file so it
          costs no request.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem("uniapp-theme");document.documentElement.setAttribute("data-theme",s==="dark"?"dark":"light")}catch{document.documentElement.setAttribute("data-theme","light")}`,
          }}
        />
        {UI === "pleurat" && (
          <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" />
        )}
      </head>
      <body className={FONTS[UI]}>
        <AppNav />
        {children}
      </body>
    </html>
  );
}
