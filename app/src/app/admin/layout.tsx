export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-line bg-paper-raised px-6 py-3">
        <span className="text-base font-semibold text-brand-600">پرزبوی — پنل مدیریت</span>
      </header>
      <main className="flex flex-1 flex-col px-6 py-6">{children}</main>
    </div>
  );
}
