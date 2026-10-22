import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, JetBrains_Mono, Patrick_Hand, Source_Sans_3, Special_Gothic_Expanded_One } from "next/font/google";
import { AppNav } from "@/components/AppNav";
import "./globals.css";
import "./ui-styles.css";

/*
 * Which visual style to render. Two candidate styles are under review, each
 * served by its own dev server (see "dev:appsignal" and "dev:pleurat" in
 * package.json); unset, it's the original look. Read at build time, so a
 * server shows one style for its whole life.
 */
type Ui = "classic" | "appsignal" | "pleurat";
const UI: Ui =
  process.env.NEXT_PUBLIC_UI === "appsignal" || process.env.NEXT_PUBLIC_UI === "pleurat" ? process.env.NEXT_PUBLIC_UI : "classic";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const gothic = Special_Gothic_Expanded_One({ subsets: ["latin"], weight: "400", variable: "--font-display", display: "swap" });
const hand = Patrick_Hand({ subsets: ["latin"], weight: "400", variable: "--font-hand", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

const FONTS: Record<Ui, string> = {
  classic: `${inter.variable} ${jetbrains.variable} ${hand.variable}`,
  appsignal: `${sourceSans.variable} ${jetbrains.variable} ${gothic.variable} ${hand.variable}`,
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
          never gets a white flash on load. Inline rather than a file so it
          costs no request.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem("uniapp-theme");document.documentElement.setAttribute("data-theme",s==="light"||s==="dark"?s:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch{document.documentElement.setAttribute("data-theme","light")}`,
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
