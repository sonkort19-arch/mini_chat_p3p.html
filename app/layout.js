export const metadata = {
  title: "Mini Chat",
  description: "Временный чат без сохранения переписки",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
