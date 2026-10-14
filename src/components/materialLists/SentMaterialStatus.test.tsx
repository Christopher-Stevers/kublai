import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SentMaterialStatus } from "./SentMaterialStatus";
afterEach(cleanup);
it("shows received and outstanding amounts with an exact order link", () => {
  render(<SentMaterialStatus materialListId="list" unit="boxes" order={{id:"order",number:"ORDER-003",status:"sent",quantity:"5",receivedQuantity:"2",verificationStatus:"partial"}} />);
  expect(screen.getByText("Part delivered")).toBeTruthy();
  expect(screen.getByText("Outstanding: 3 boxes")).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe("/dashboard/material-lists/list?orderId=order");
});
it("keeps delivery issues visible even if the received count is complete", () => {
  render(<SentMaterialStatus materialListId="list" order={{id:"order",number:"ORDER-003",status:"sent",quantity:"5",receivedQuantity:"5",verificationStatus:"problem"}} />);
  expect(screen.getByText("Delivery issue")).toBeTruthy();
});
