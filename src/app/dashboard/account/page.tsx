import { PaymentSetupWrapper } from "~/app/_components/PaymentSetupWrapper";

export default function AccountPage() {
  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-8 text-3xl font-bold text-gray-900">Account</h1>
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 text-xl font-semibold text-gray-900">
              Payment Method
            </h2>
            <p className="mb-6 text-sm text-gray-600">
              Manage your payment information. Your card details are securely
              stored by Stripe.
            </p>
            <PaymentSetupWrapper />
          </section>
        </div>
      </div>
    </div>
  );
}

