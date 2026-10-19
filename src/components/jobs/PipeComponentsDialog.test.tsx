import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PipeComponentsDialog } from "./PipeComponentsDialog";
import type { PipeComponentCandidate } from "~/lib/pipe-components-types";
const candidate: PipeComponentCandidate = {
  id: "pc1",
  fingerprint: "f1",
  kind: "valve",
  name: "Valve",
  source: "geometry",
  system: "DCW",
  evidence: "Possible symbol; verify against legend.",
  point: { x: 0.5, y: 0.5 },
  box: { left: 0.49, right: 0.51, top: 0.49, bottom: 0.51 },
};
function open(writable = true, onConfirm = vi.fn().mockResolvedValue(true)) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    result: { candidates: [candidate], warnings: [], partial: false },
    analyzing: false,
    error: null,
    sourceKey: "revision1",
    annotations: [],
    writable,
    templateCount: 0,
    onAnalyze: vi.fn(),
    onLocate: vi.fn(),
    onConfirm,
    onTeach: vi.fn(),
  };
  return { ...render(<PipeComponentsDialog {...props} />), props };
}
afterEach(cleanup);
it("does not save automatically and read-only users can locate but cannot confirm or teach", () => {
  const { props } = open(false);
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Confirm count" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Export reviewed counts" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Locate Valve" }));
  expect(props.onLocate).toHaveBeenCalledWith(candidate);
  fireEvent.click(screen.getByText(/Symbol references/));
  expect(screen.queryByRole("button", { name: "Pick symbol" })).toBeNull();
});
it("retains the candidate on a failed save and retries corrected details", async () => {
  const confirm = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  open(true, confirm);
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
  fireEvent.change(screen.getByLabelText("Component name"), {
    target: { value: "Gate valve" },
  });
  fireEvent.change(screen.getByLabelText("Component size"), {
    target: { value: "DN50" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm count" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
  expect(screen.queryByText("Reviewed", { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Confirm count" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(confirm).toHaveBeenLastCalledWith(
    candidate,
    expect.objectContaining({ name: "Gate valve", size: "DN50" }),
  );
});
it("allows temporary dismissal and restores dismissed candidates for review", () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(
    within(
      screen.getByRole("list", { name: "Component candidates" }),
    ).queryByRole("listitem"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show dismissed (1)" }));
  expect(
    within(
      screen.getByRole("list", { name: "Component candidates" }),
    ).getByText("Valve", { exact: true }),
  ).toBeInTheDocument();
});
it("guards against repeated confirmation while persistence is pending", async () => {
  let resolve: (value: boolean) => void = () => undefined;
  const confirm = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  open(true, confirm);
  const button = screen.getByRole("button", { name: "Confirm count" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  resolve(true);
  await waitFor(() => expect(screen.getByRole("button", {name:"Confirm count"})).toBeEnabled());
});

it('uses saved records as the authority and removes review status if a count is deleted',()=>{
 const view=open();
 const data={sourceSheetId:'031060be-2d10-4c21-bda2-dd1619a1e280',type:'count' as const,points:[candidate.point],stroke:'#000000',width:2,pipeComponent:{candidateId:candidate.id,fingerprint:candidate.fingerprint,sourceKey:'revision1',kind:candidate.kind,name:'Gate valve',system:candidate.system,evidence:candidate.evidence,source:candidate.source}};
 const record={id:'one',sheetId:data.sourceSheetId,kind:'markup' as const,data,revision:1,visibility:'published' as const,authorId:'tim',authorName:'Tim',comments:[],createdAt:'',updatedAt:''};
 view.rerender(<PipeComponentsDialog {...view.props} annotations={[record]} />);
 expect(screen.getByText('Reviewed',{exact:true})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Export reviewed counts'})).toBeEnabled();
 expect(screen.getByText('1 candidates · 1 reviewed')).toBeInTheDocument();
 view.rerender(<PipeComponentsDialog {...view.props} annotations={[]} />);
 expect(screen.queryByText('Reviewed',{exact:true})).toBeNull();
 expect(screen.getByRole('button',{name:'Export reviewed counts'})).toBeDisabled();
});
