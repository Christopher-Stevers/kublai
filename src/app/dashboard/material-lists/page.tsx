"use client";

import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { PlusIcon, PackageIcon, CalendarIcon, UserIcon } from "lucide-react";
import { format } from "date-fns";

export default function MaterialListsPage() {
  const router = useRouter();
  const { data: materialLists, isLoading } =
    api.materialList.listMaterialLists.useQuery();

  const createMaterialList = api.materialList.createMaterialList.useMutation({
    onSuccess: (data) => {
      router.push(`/dashboard/material-lists/${data.materialListId}`);
    },
  });

  const handleCreateNew = () => {
    createMaterialList.mutate();
  };

  if (isLoading) {
    return (
      <div className="px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading material lists...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Material Lists</h1>
            <p className="text-muted-foreground mt-2">
              Create and manage your material lists for jobs
            </p>
          </div>
          <Button onClick={handleCreateNew} size="lg">
            <PlusIcon className="mr-2 h-5 w-5" />
            New Material List
          </Button>
        </div>

        {!materialLists || materialLists.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
              <h3 className="mb-2 text-lg font-semibold">No material lists yet</h3>
              <p className="text-muted-foreground mb-4 text-center">
                Create your first material list to get started
              </p>
              <Button onClick={handleCreateNew}>
                <PlusIcon className="mr-2 h-4 w-4" />
                New Material List
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {materialLists.map((list) => (
              <Card
                key={list.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => router.push(`/dashboard/material-lists/${list.id}`)}
              >
                <CardHeader>
                  <CardTitle className="line-clamp-1">{list.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <PackageIcon className="h-4 w-4" />
                      <span>{list.itemCount} items</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Total:</span>
                      <span>${list.materialTotal.toFixed(2)}</span>
                    </div>
                    {list.foreman && (
                      <div className="flex items-center gap-2">
                        <UserIcon className="h-4 w-4" />
                        <span>{list.foreman.name}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      <span>
                        {format(new Date(list.createdAt), "MMM d, yyyy")}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

