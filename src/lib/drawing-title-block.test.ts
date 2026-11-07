import { describe, it, expect } from "vitest";
import {
  extractDrawingIdentity,
  pdfTitleBlockWord,
  type TitleBlockWord,
} from "./drawing-title-block";
const w = (
  text: string,
  left: number,
  top: number,
  width = 0.15,
  height = 0.009,
): TitleBlockWord => ({
  text,
  left,
  top,
  right: left + width,
  bottom: top + height,
});
describe("drawing identity extraction", () => {
  it("prefers the labeled identity over sheet references, project numbers and drawing-index entries", () => {
    expect(
      extractDrawingIdentity([
        w("M-307", 0.73, 0.8),
        w("NINTH FLOOR PLAN - HVAC", 0.76, 0.8),
        w("PROJ. No.", 0.91, 0.96, 0.03),
        w("2024-0339", 0.94, 0.96, 0.02),
        w("DWG No.", 0.97, 0.96, 0.025),
        w("M-001", 0.95, 0.976, 0.04, 0.012),
        w("DWG TITLE", 0.91, 0.895, 0.06),
        w("Drawing List and Legend", 0.91, 0.91, 0.08),
      ]),
    ).toEqual({
      number: "M-001",
      title: "Drawing List and Legend",
      discipline: "Mechanical",
    });
  });
  it("joins fragmented labels, drawing codes and multiline titles without consuming scale or project fields", () => {
    const words = [
      w("SHEET", 0.72, 0.78, 0.035),
      w("TITLE", 0.76, 0.78, 0.035),
      w("P1 Grade Plumbing &", 0.72, 0.795, 0.17),
      w("Drainage", 0.72, 0.812, 0.1),
      w("SCALE:", 0.72, 0.85, 0.05),
      w("1:100", 0.8, 0.85, 0.04),
      w("DWG NO.", 0.8, 0.9, 0.06),
      w("M", 0.8, 0.92, 0.008),
      w("-", 0.81, 0.92, 0.004),
      w("101", 0.816, 0.92, 0.023),
    ];
    expect(extractDrawingIdentity(words)).toEqual({
      number: "M-101",
      title: "P1 Grade Plumbing & Drainage",
      discipline: "Mechanical",
    });
  });
  it("handles explicit bottom-left and top-right fields and numeric sheet codes", () => {
    expect(
      extractDrawingIdentity([
        w("Drawing Title: General Notes", 0.03, 0.88, 0.4),
        w("Sheet Number: 101", 0.04, 0.95, 0.3),
      ]),
    ).toEqual({ number: "101", title: "General Notes", discipline: "" });
    expect(
      extractDrawingIdentity([
        w("DWG TITLE: Roof Plan", 0.8, 0.04, 0.18),
        w("DWG No: A1.02", 0.8, 0.09, 0.17),
      ]),
    ).toMatchObject({ number: "A1.02", title: "Roof Plan" });
  });
  it("does not invent identities from body annotations, filenames, dates or project addresses", () => {
    expect(
      extractDrawingIdentity([
        w("A-101", 0.2, 0.4),
        w("SECOND FLOOR PLAN", 0.3, 0.4),
        w("601 Scottsdale Dr", 0.92, 0.8, 0.06),
        w("2024-0339", 0.92, 0.93, 0.06),
        w("24-09-27", 0.92, 0.95, 0.05),
      ]),
    ).toEqual({ number: "", title: "", discipline: "" });
    expect(extractDrawingIdentity([])).toEqual({
      number: "",
      title: "",
      discipline: "",
    });
  });
  it("finds unlabeled isolated codes and nearby titles, without selecting embedded references", () => {
    expect(
      extractDrawingIdentity([
        w("SEE M-100 FOR DETAILS", 0.74, 0.9, 0.2),
        w("LEVEL 2 FLOOR PLAN", 0.8, 0.88, 0.17),
        w("A2.01", 0.86, 0.94, 0.08, 0.018),
      ]),
    ).toMatchObject({ number: "A2.01", title: "LEVEL 2 FLOOR PLAN" });
  });
  it("accepts numbered floor titles and standalone field labels", () => {
    expect(
      extractDrawingIdentity([
        w("TITLE", 0.8, 0.8, 0.05),
        w("2ND FLOOR PLAN", 0.8, 0.82, 0.15),
        w("SHEET", 0.9, 0.9, 0.05),
        w("A-102", 0.9, 0.93, 0.05),
      ]),
    ).toMatchObject({ number: "A-102", title: "2ND FLOOR PLAN" });
  });
  it("uses a rotated PDF viewport for the complete text rectangle", () => {
    const box = pdfTitleBlockWord(
      {
        str: "A101",
        transform: [0, 10, -10, 0, 90, 20],
        width: 30,
        height: 10,
      },
      {
        width: 100,
        height: 100,
        convertToViewportPoint: (x, y) => [y, 100 - x],
      },
    );
    expect(box).toEqual({
      text: "A101",
      left: 0.2,
      right: 0.5,
      top: 0.1,
      bottom: 0.2,
    });
  });
});
