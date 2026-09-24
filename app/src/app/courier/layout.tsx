export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-[#F7F9F8]">
      <header className="border-b border-gray-100 bg-white px-4 py-4">
        <span className="text-lg font-bold text-emerald-600">پرزبوی — پیک</span>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
