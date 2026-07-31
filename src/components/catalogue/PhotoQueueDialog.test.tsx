import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PhotoQueueDialog } from "./PhotoQueueDialog";

const applyPhotoQueueImage = vi.fn().mockResolvedValue({ updatedCount: 1 });

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    unoptimized?: boolean;
  }) => <img {...props} />,
}));

vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      catalogue: {
        getPhotoQueue: { invalidate: vi.fn().mockResolvedValue(undefined) },
        searchParts: { invalidate: vi.fn().mockResolvedValue(undefined) },
        getPartWizardSummary: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
        listPhotoAssets: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
    }),
    catalogue: {
      getPhotoQueue: {
        useQuery: () => ({
          isLoading: false,
          data: {
            missingPartCount: 2,
            groups: [
              {
                id: "plumbing:abs:fitting:90",
                familyLabel: "90 Elbow",
                catalogName: "Plumbing",
                materialName: "ABS",
                categoryName: "Fitting",
                existingImageUrl: "/api/catalogue/images/part-reviewed.webp",
                searchPartId: "11111111-1111-4111-8111-111111111111",
                googleSearchUrl:
                  "https://www.google.com/search?tbm=isch&q=ABS+90+Elbow",
                parts: [
                  {
                    id: "11111111-1111-4111-8111-111111111111",
                    displayName: '2" ABS 90 Elbow',
                    description: "90 Elbow",
                    size: '2"',
                  },
                  {
                    id: "22222222-2222-4222-8222-222222222222",
                    displayName: '3" ABS 90 Elbow',
                    description: "90 Elbow",
                    size: '3"',
                  },
                ],
              },
            ],
          },
        }),
      },
      storeRemoteCatalogueImage: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      applyPhotoQueueImage: {
        useMutation: (options: { onSuccess?: () => void }) => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            const result = await applyPhotoQueueImage(input);
            await options.onSuccess?.();
            return result;
          },
        }),
      },
      listPhotoAssets: {
        useQuery: () => ({
          isLoading: false,
          data: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              organizationId: "44444444-4444-4444-8444-444444444444",
              storageKey: "part-reviewed.webp",
              url: "/api/catalogue/images/part-reviewed.webp",
              originalFilename: "reviewed-elbow.webp",
              contentType: "image/webp",
              byteSize: 4096,
              checksum: "abc123",
              sourceUrl: null,
              notes: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              usageCount: 2,
              duplicateCount: 1,
            },
          ],
        }),
      },
      deleteUnusedPhotoAsset: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      replacePhotoAssetEverywhere: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

describe("PhotoQueueDialog", () => {
  beforeEach(() => {
    cleanup();
    applyPhotoQueueImage.mockClear();
  });

  it("starts with the safe family selected and applies only reviewed parts", async () => {
    render(
      <PhotoQueueDialog open onOpenChange={() => {}} catalogId="catalog-id" />,
    );

    expect(
      screen.getByText("A reviewed photo already exists in this family."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply to 2" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('3" ABS 90 Elbow'));
    fireEvent.click(screen.getByRole("button", { name: "Apply to 1" }));

    await waitFor(() => {
      expect(applyPhotoQueueImage).toHaveBeenCalledWith({
        imageUrl: "/api/catalogue/images/part-reviewed.webp",
        partIds: ["11111111-1111-4111-8111-111111111111"],
      });
    });
  });

  it("opens the managed photo library with usage metadata", () => {
    render(<PhotoQueueDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Library" }));

    expect(screen.getByText("reviewed-elbow.webp")).toBeInTheDocument();
    expect(screen.getByText("2 uses")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search filenames, source URLs, or notes"),
    ).toBeInTheDocument();
  });
});
