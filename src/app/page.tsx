"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { MarketingHeader } from "./_components/MarketingHeader";
import { Button } from "~/components/ui/button";

export default function Home() {
  const [heroImageError, setHeroImageError] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <MarketingHeader />

      {/* Hero Section */}
      <section className="relative mt-20 flex min-h-[85vh] items-center justify-center overflow-hidden bg-white px-6 py-16 sm:py-24">
        {/* Texture Background */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 mx-auto w-full max-w-[1100px]">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            {/* Left: Text Content */}
            <div className="text-center lg:text-left">
              <h1 className="mb-6 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
                Order plumbing materials in seconds.
              </h1>
              <p className="mb-8 text-lg text-gray-600 sm:text-xl">
                Search parts. Build orders. Send to your supplier.
                <br />
                <span className="font-medium">
                  Built for crews, not spreadsheets.
                </span>
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:justify-center lg:justify-start">
                <Button
                  asChild
                  size="lg"
                  className="h-12 bg-blue-600 px-8 text-base font-semibold text-white hover:bg-blue-700 focus:bg-blue-700"
                >
                  <Link href="/dashboard">Start an Order</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-12 border-2 border-blue-600 px-8 text-base font-semibold text-blue-600 hover:bg-blue-50 focus:bg-blue-50"
                >
                  <Link href="#how-it-works">See How It Works</Link>
                </Button>
              </div>
            </div>

            {/* Right: Hero Image */}
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg">
              {/* Blue overlay */}
              <div className="absolute inset-0 z-10 bg-blue-600/12" />

              {/* Image container with filters */}
              <div className="relative h-full w-full bg-gray-100">
                {!heroImageError ? (
                  <Image
                    src="/images/hero-plumber-jobsite.png"
                    alt="Tradesperson using phone on jobsite to order plumbing materials"
                    fill
                    className="object-cover"
                    style={{
                      filter: "saturate(0.85) brightness(0.95)",
                    }}
                    onError={() => setHeroImageError(true)}
                    priority
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400">
                    <svg
                      className="h-24 w-24"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value Props Section */}
      <section className="border-t border-gray-200 bg-white px-6 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-[1100px]">
          <div className="grid gap-8 sm:grid-cols-3">
            {/* Fast Ordering */}
            <div className="text-center sm:text-left">
              <div className="mb-4 flex justify-center sm:justify-start">
                <div className="rounded-lg bg-blue-50 p-3">
                  <svg
                    className="h-6 w-6 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900">
                Fast Ordering
              </h3>
              <p className="text-gray-600">
                Find parts by type, size, and material.
              </p>
            </div>

            {/* Supplier-Aware */}
            <div className="text-center sm:text-left">
              <div className="mb-4 flex justify-center sm:justify-start">
                <div className="rounded-lg bg-blue-50 p-3">
                  <svg
                    className="h-6 w-6 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900">
                Supplier-Aware
              </h3>
              <p className="text-gray-600">
                Each job can use a different supplier.
              </p>
            </div>

            {/* Built for the Field */}
            <div className="text-center sm:text-left">
              <div className="mb-4 flex justify-center sm:justify-start">
                <div className="rounded-lg bg-blue-50 p-3">
                  <svg
                    className="h-6 w-6 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                    />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900">
                Built for the Field
              </h3>
              <p className="text-gray-600">Works on your phone, one-handed.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section
        id="how-it-works"
        className="border-t border-gray-200 bg-gray-50 px-6 py-16 sm:py-24"
      >
        <div className="mx-auto w-full max-w-[1100px]">
          <h2 className="mb-12 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
            How It Works
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-bold text-white">
                1
              </div>
              <p className="text-lg text-gray-900">Search parts</p>
            </div>
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-bold text-white">
                2
              </div>
              <p className="text-lg text-gray-900">Add quantities</p>
            </div>
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-bold text-white">
                3
              </div>
              <p className="text-lg text-gray-900">Send order</p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA Section */}
      <section className="border-t border-gray-200 bg-white px-6 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-[1100px] text-center">
          <h2 className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl">
            Stop texting part lists.
            <br />
            Start ordering quickly.
          </h2>
          <div className="mt-8 flex justify-center">
            <Button
              asChild
              size="lg"
              className="h-12 bg-blue-600 px-8 text-base font-semibold text-white hover:bg-blue-700 focus:bg-blue-700"
            >
              <Link href="/dashboard">Start an Order</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white px-6 py-12">
        <div className="mx-auto w-full max-w-[1100px] text-center text-sm text-gray-600">
          © {new Date().getFullYear()} ForemanHQ. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
