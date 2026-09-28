import type { ClientBrand } from "@kody-ade/base/client-brand";
import { directionForLocale } from "../chat/platform/i18n";

export function ClientAccessGate({
  brand,
  forbidden = false,
}: {
  brand: ClientBrand;
  forbidden?: boolean;
}) {
  return (
    <main
      data-testid="client-access-gate"
      dir={directionForLocale(brand.locale ?? "en")}
      className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground"
    >
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <span
          className="mx-auto mb-4 block h-10 w-10 rounded-lg"
          style={{ backgroundColor: brand.accent }}
          aria-hidden="true"
        />
        <h1 className="text-xl font-semibold">{brand.name}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {forbidden
            ? "This session belongs to a different client surface."
            : "Open this chat from the application that provides your access."}
        </p>
      </section>
    </main>
  );
}
