export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-paper">
      <header className="border-b border-line px-4 py-4">
        <span className="text-lg font-semibold text-brand-600">پرزبوی</span>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
