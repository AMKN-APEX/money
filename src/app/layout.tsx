import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "家計簿",
  description: "個人用の家計簿",
  appleWebApp: {
    capable: true,
    title: "家計簿",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // iPhone のセーフエリアまで描画する
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
