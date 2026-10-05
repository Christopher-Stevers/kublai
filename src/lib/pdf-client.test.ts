import { describe, expect, it } from "vitest";
import { sourcePdfPage } from "./pdf-client";

const job = "0391aed4-7773-47ec-9141-09df373ec008";
const upload = "d814fc88-da7c-4df5-aa89-fe3c1fde0462";

describe("sourcePdfPage", () => {
  it("maps a split drawing image to its original PDF page", () => {
    expect(sourcePdfPage(`/api/job-rooms/files/${job}/${upload}/floor-14.webp`)).toEqual({
      url: `/api/job-rooms/files/${job}/${upload}/plan.pdf`,
      page: 14,
    });
  });
  it("ignores anything else", () => {
    expect(sourcePdfPage(`/api/job-rooms/files/${job}/floor-1.webp`)).toBeNull();
    expect(sourcePdfPage("https://evil.example/floor-1.webp")).toBeNull();
    expect(sourcePdfPage(`/api/job-rooms/files/${job}/${upload}/plan.pdf`)).toBeNull();
  });
});
