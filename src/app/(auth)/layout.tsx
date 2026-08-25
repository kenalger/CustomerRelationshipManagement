export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sunken p-6">
      <div className="w-full max-w-[360px]">{children}</div>
    </main>
  );
}
