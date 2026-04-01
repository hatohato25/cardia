import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cardia - MTGカード価格認識",
  description: "MTGカードをカメラで撮影してHareruyaの価格をリアルタイムに表示するアプリ",
};

// iOS でのピンチズーム・スクロールを防ぎ、カメラUIを固定表示するための設定
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
