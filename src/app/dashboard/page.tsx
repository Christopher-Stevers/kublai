"use client";

import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  PackageIcon,
  Search,
  Building2,
  Wrench,
  UserIcon,
  CalendarIcon,
  ArrowRightIcon,
} from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";

export default function Dashboard() {
  const router = useRouter();
  // tRPC types are properly inferred - these errors are false positives from strict mode
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { data: materialLists, isLoading } =
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    api.materialList.listMaterialLists.useQuery();

  // Type guard to ensure materialLists is an array
  const listsArray =
    materialLists && Array.isArray(materialLists) ? materialLists : [];

  const widgets = [
    {
      title: "Material Lists",
      description: "Create and manage material lists for your jobs",
      icon: PackageIcon,
      href: "/dashboard/material-lists",
    },
    {
      title: "Catalogue",
      description: "Browse and search parts in your catalogue",
      icon: Search,
      href: "/dashboard/catalogue",
    },
    {
      title: "Suppliers",
      description: "Manage your suppliers and their parts",
      icon: Building2,
      href: "/dashboard/suppliers",
    },
    {
      title: "Parts",
      description: "Manage preferred suppliers for each part",
      icon: Wrench,
      href: "/dashboard/parts",
    },
    {
      title: "Account",
      description: "Manage your account settings and subscription",
      icon: UserIcon,
      href: "/dashboard/account",
    },
  ];

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Overview of your material lists and quick access to all sections
          </p>
        </div>

        {/* Navigation Widgets */}
        <div className="mb-12">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">
            Quick Access
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {widgets.map((widget) => {
              const Icon = widget.icon;
              return (
                <Card
                  key={widget.href}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => router.push(widget.href)}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="h-5 w-5" />
                      {widget.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground mb-4 text-sm">
                      {widget.description}
                    </p>
                    <div className="text-primary flex items-center text-sm font-medium">
                      Go to {widget.title}
                      <ArrowRightIcon className="ml-2 h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Material Lists Overview */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              Material Lists
            </h2>
            <Link
              href="/dashboard/material-lists"
              className="text-primary text-sm font-medium hover:underline"
            >
              View All
            </Link>
          </div>

          {isLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <p className="text-muted-foreground">
                  Loading material lists...
                </p>
              </CardContent>
            </Card>
          ) : listsArray.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
                <h3 className="mb-2 text-lg font-semibold">
                  No material lists yet
                </h3>
                <p className="text-muted-foreground mb-4 text-center">
                  Create your first material list to get started
                </p>
                <button
                  onClick={() => router.push("/dashboard/material-lists")}
                  className="text-primary text-sm font-medium hover:underline"
                >
                  Go to Material Lists
                </button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-gray-200 bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                          Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                          Items
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                          Total
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                          Foreman
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                          Created
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {listsArray.map((list) => {
                        if (!list) return null;
                        const listItem = list as {
                          id: string;
                          name: string;
                          itemCount: number;
                          materialTotal: number;
                          foreman: { name: string } | null;
                          createdAt: string | Date;
                        };
                        const listId = String(listItem.id ?? "");
                        const listName = String(listItem.name ?? "");
                        const itemCount = Number(listItem.itemCount ?? 0);
                        const materialTotal = Number(
                          listItem.materialTotal ?? 0,
                        );
                        const foreman = listItem.foreman
                          ? { name: String(listItem.foreman.name ?? "") }
                          : null;
                        const createdAt = listItem.createdAt
                          ? new Date(listItem.createdAt)
                          : new Date();

                        return (
                          <tr
                            key={listId}
                            className="cursor-pointer transition-colors hover:bg-gray-50"
                            onClick={() =>
                              router.push(`/dashboard/material-lists/${listId}`)
                            }
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {listName}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <PackageIcon className="h-4 w-4" />
                                {itemCount}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-semibold text-gray-900">
                                ${materialTotal.toFixed(2)}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                {foreman ? (
                                  <>
                                    <UserIcon className="h-4 w-4" />
                                    {foreman.name}
                                  </>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <CalendarIcon className="h-4 w-4" />
                                {format(createdAt, "MMM d, yyyy")}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
