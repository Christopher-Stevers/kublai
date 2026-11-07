import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PartImage from "./PartImage";
vi.mock("~/lib/part-image-layouts.json", () => ({ default: {
  "/audited.webp": {width: 600, height: 400, box: [30,40,500,300],background:"#fafafa"},
} }));
vi.mock("next/image", () => ({default: ({fill: _fill, ...props}: {fill?: boolean}) => <img {...props} />}));
afterEach(cleanup);
it("contains the reviewed source region inside padding, with its matching background", () => {
 const {container}=render(<PartImage src="/audited.webp" alt="Elbow" fill className="part-photo" />);
 expect(screen.getByRole("img", {name:"Elbow"}).tagName.toLowerCase()).toBe("svg");
 expect(container.querySelector('rect')).toHaveAttribute('fill','#fafafa');
 expect(container.querySelector('svg svg')).toHaveAttribute('viewBox','30 40 500 300');
 expect(container.querySelector('svg svg')).toHaveAttribute('preserveAspectRatio','xMidYMid meet');
 expect(container.querySelector('svg svg')).toHaveAttribute('x','8%');
 expect(container.querySelector('image')).toHaveAttribute('href','/audited.webp');
 expect(container.querySelector('image')).toHaveAttribute('width','600');
});
it("leaves unaudited sources unchanged instead of guessing a crop", () => {
 render(<PartImage src="/new-photo.webp" alt="New part" width={48} height={48} />);
 expect(screen.getByRole('img',{name:'New part'}).tagName.toLowerCase()).toBe('img');
 expect(screen.getByRole('img',{name:'New part'})).toHaveAttribute('src','/new-photo.webp');
});
