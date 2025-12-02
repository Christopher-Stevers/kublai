"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { MarketingHeader } from "./_components/MarketingHeader";

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
};

// Reusable animated section component
function AnimatedSection({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={fadeInUp}
      transition={{ duration: 0.6 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function Home() {
  const valuePropsRef = useRef(null);
  const howItWorksRef = useRef(null);
  const galleryRef = useRef(null);

  const valuePropsInView = useInView(valuePropsRef, { once: true, margin: "-100px" });
  const howItWorksInView = useInView(howItWorksRef, { once: true, margin: "-100px" });
  const galleryInView = useInView(galleryRef, { once: true, margin: "-100px" });

  return (
    <div className="flex min-h-screen flex-col bg-white">
        <MarketingHeader />

        {/* Hero Section */}
        <section className="relative mt-20 flex min-h-[90vh] items-center justify-center overflow-hidden bg-gradient-to-br from-gray-50 via-white to-gray-100 px-6 py-24">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,0,0,0.02),transparent_50%)]" />
          <div className="relative z-10 mx-auto max-w-6xl text-center">
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="mb-6 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl md:text-7xl"
            >
              Mobile Advertising That{" "}
              <span className="bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                Moves
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="mb-10 text-xl text-gray-600 sm:text-2xl"
            >
              Reach your target audience with digital boards on trade trucks, tow
              trucks, and service trucks. Maximum visibility, targeted reach,
              cost-effective campaigns.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-col gap-4 sm:flex-row sm:justify-center"
            >
              <Link
                href="/dashboard"
                className="group relative overflow-hidden rounded-lg bg-gray-900 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-gray-800 hover:shadow-xl"
              >
                <span className="relative z-10">Get Started</span>
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-gray-800 to-gray-700"
                  initial={{ x: "-100%" }}
                  whileHover={{ x: 0 }}
                  transition={{ duration: 0.3 }}
                />
              </Link>
              <Link
                href="#how-it-works"
                className="rounded-lg border-2 border-gray-300 bg-white px-8 py-4 text-lg font-semibold text-gray-900 transition-all hover:border-gray-400 hover:bg-gray-50"
              >
                Learn More
              </Link>
            </motion.div>
          </div>

          {/* Decorative elements */}
          <motion.div
            className="absolute -right-20 top-20 h-64 w-64 rounded-full bg-gray-200/30 blur-3xl"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
          <motion.div
            className="absolute -left-20 bottom-20 h-64 w-64 rounded-full bg-gray-300/30 blur-3xl"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 2,
            }}
          />
        </section>

        {/* Value Proposition Section */}
        <section
          id="features"
          ref={valuePropsRef}
          className="border-t border-gray-200 bg-white px-6 py-24"
        >
          <div className="mx-auto max-w-6xl">
            <motion.div
              initial="hidden"
              animate={valuePropsInView ? "visible" : "hidden"}
              variants={fadeInUp}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-bold text-gray-900">
                Why Choose Mobile Digital Advertising?
              </h2>
              <p className="text-xl text-gray-600">
                Stand out from traditional advertising with dynamic, mobile
                campaigns
              </p>
            </motion.div>

            <motion.div
              initial="hidden"
              animate={valuePropsInView ? "visible" : "hidden"}
              variants={staggerContainer}
              className="grid gap-8 md:grid-cols-2 lg:grid-cols-4"
            >
              {[
                {
                  icon: (
                    <svg
                      className="h-8 w-8"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  ),
                  title: "Maximum Visibility",
                  description:
                    "Trucks drive through high-traffic areas, ensuring your message reaches thousands of potential customers daily.",
                },
                {
                  icon: (
                    <svg
                      className="h-8 w-8"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  ),
                  title: "Targeted Reach",
                  description:
                    "Service trucks visit specific neighborhoods and commercial areas, delivering your message to the right audience.",
                },
                {
                  icon: (
                    <svg
                      className="h-8 w-8"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  ),
                  title: "Cost-Effective",
                  description:
                    "More affordable than traditional billboards with better ROI. Pay only for the time you need.",
                },
                {
                  icon: (
                    <svg
                      className="h-8 w-8"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  ),
                  title: "Easy Booking",
                  description:
                    "Simple online platform. Choose your dates, upload your creative, and launch your campaign in minutes.",
                },
              ].map((prop, index) => (
                <motion.div
                  key={index}
                  variants={scaleIn}
                  whileHover={{ scale: 1.05, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className="group rounded-xl bg-gradient-to-br from-gray-50 to-white p-8 shadow-sm transition-all hover:shadow-lg"
                >
                  <div className="mb-4 text-gray-900">{prop.icon}</div>
                  <h3 className="mb-3 text-xl font-semibold text-gray-900">
                    {prop.title}
                  </h3>
                  <p className="text-gray-600">{prop.description}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* How It Works Section */}
        <section
          id="how-it-works"
          ref={howItWorksRef}
          className="border-t border-gray-200 bg-gray-50 px-6 py-24"
        >
          <div className="mx-auto max-w-6xl">
            <motion.div
              initial="hidden"
              animate={howItWorksInView ? "visible" : "hidden"}
              variants={fadeInUp}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-bold text-gray-900">
                How It Works
              </h2>
              <p className="text-xl text-gray-600">
                Launch your mobile advertising campaign in four simple steps
              </p>
            </motion.div>

            <motion.div
              initial="hidden"
              animate={howItWorksInView ? "visible" : "hidden"}
              variants={staggerContainer}
              className="grid gap-8 md:grid-cols-2 lg:grid-cols-4"
            >
              {[
                {
                  step: "01",
                  title: "Choose Board Type",
                  description:
                    "Select from trade trucks, tow trucks, or service trucks based on your target audience.",
                },
                {
                  step: "02",
                  title: "Select Dates & Availability",
                  description:
                    "Browse real-time availability and choose the dates that work best for your campaign.",
                },
                {
                  step: "03",
                  title: "Upload Your Creative",
                  description:
                    "Upload your digital creative assets. Our platform supports high-quality images and videos.",
                },
                {
                  step: "04",
                  title: "Launch Your Campaign",
                  description:
                    "Complete secure payment and watch your campaign go live. Track performance in real-time.",
                },
              ].map((step, index) => (
                <motion.div
                  key={index}
                  variants={fadeInUp}
                  className="relative"
                >
                  <div className="rounded-xl bg-white p-8 shadow-sm">
                    <div className="mb-4 text-5xl font-bold text-gray-200">
                      {step.step}
                    </div>
                    <h3 className="mb-3 text-xl font-semibold text-gray-900">
                      {step.title}
                    </h3>
                    <p className="text-gray-600">{step.description}</p>
                  </div>
                  {index < 3 && (
                    <div className="absolute -right-4 top-1/2 hidden -translate-y-1/2 lg:block">
                      <svg
                        className="h-8 w-8 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Image Gallery Section */}
        <section
          ref={galleryRef}
          className="border-t border-gray-200 bg-white px-6 py-24"
        >
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial="hidden"
              animate={galleryInView ? "visible" : "hidden"}
              variants={fadeInUp}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-bold text-gray-900">
                See Our Mobile Advertising in Action
              </h2>
              <p className="text-xl text-gray-600">
                Digital boards on trade trucks, tow trucks, and service trucks
                delivering your message where it matters
              </p>
            </motion.div>

            <motion.div
              initial="hidden"
              animate={galleryInView ? "visible" : "hidden"}
              variants={staggerContainer}
              className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
            >
              {[
                {
                  src: "/images/trade-truck-1.png",
                  alt: "Trade truck with digital advertising board driving through urban area",
                },
                {
                  src: "/images/tow-truck-1.png",
                  alt: "Tow truck with digital advertising board on city street",
                },
                {
                  src: "/images/service-truck-1.png",
                  alt: "Service truck with digital advertising board in commercial district",
                },
                {
                  src: "/images/trade-truck-2.png",
                  alt: "Trade truck with digital advertising board in high-traffic intersection",
                },
                {
                  src: "/images/tow-truck-2.png",
                  alt: "Tow truck with digital advertising board in residential neighborhood",
                },
                {
                  src: "/images/service-truck-2.png",
                  alt: "Service truck with digital advertising board in business district",
                },
              ].map((image, index) => (
                <motion.div
                  key={index}
                  variants={scaleIn}
                  whileHover={{ scale: 1.02, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className="group relative overflow-hidden rounded-xl shadow-lg"
                >
                  <div className="relative aspect-[4/3] bg-gray-200">
                    <Image
                      src={image.src}
                      alt={image.alt}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-110"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Final CTA Section */}
        <AnimatedSection className="border-t border-gray-200 bg-white px-6 py-24">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-6 text-4xl font-bold text-gray-900">
              Ready to Launch Your Campaign?
            </h2>
            <p className="mb-10 text-xl text-gray-600">
              Get started today and reach your audience with mobile digital
              advertising
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/dashboard"
                className="group relative overflow-hidden rounded-lg bg-gray-900 px-10 py-4 text-lg font-semibold text-white transition-all hover:bg-gray-800 hover:shadow-xl"
              >
                <span className="relative z-10">Get Started Now</span>
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-gray-800 to-gray-700"
                  initial={{ x: "-100%" }}
                  whileHover={{ x: 0 }}
                  transition={{ duration: 0.3 }}
                />
              </Link>
              <Link
                href="/api/auth/signin"
                className="rounded-lg border-2 border-gray-300 bg-white px-10 py-4 text-lg font-semibold text-gray-900 transition-all hover:border-gray-400 hover:bg-gray-50"
              >
                Sign In
              </Link>
            </div>
          </div>
        </AnimatedSection>

        {/* Footer */}
        <footer className="border-t border-gray-200 bg-gray-50 px-6 py-12">
          <div className="mx-auto max-w-6xl">
            <div className="mb-8 text-center">
              <h3 className="mb-2 text-2xl font-bold text-gray-900">Genghis</h3>
              <p className="text-gray-600">Mobile Digital Advertising Platform</p>
              </div>
            <div className="border-t border-gray-200 pt-8 text-center text-sm text-gray-600">
              © {new Date().getFullYear()} Genghis. All rights reserved.
            </div>
          </div>
        </footer>
      </div>
  );
}
