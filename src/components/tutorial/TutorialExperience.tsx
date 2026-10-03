"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  Check,
  DoorOpen,
  MapPin,
  MessageCircle,
  Package,
  Plus,
  Send,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { formatMaterialListDate } from "~/lib/material-list-names";
import styles from "./TutorialExperience.module.css";

const STEPS = [
  [
    "Jobs",
    "Practice with a sample job. Everything here stays in this tutorial.",
  ],
  ["Demo job", "Each job has its own material lists, rooms and chat."],
  ["Material Lists", "Create a list for the materials you need on this job."],
  [
    "New material list",
    "Lists start with today's date. You can give yours another name.",
  ],
  ["Your material list", "Add the first part to your practice list."],
  ["Select Catalog", "Start with the catalog your part belongs to."],
  ["Select Material", "Material groups keep related types together."],
  ["Select PVC type", "Choose the specific material you need."],
  ["Select Size", "Narrow the catalog to the right size."],
  ["Select Category", "Choose a category to find the part."],
  ["Select Part", "Select the fitting for this practice order."],
  ["Quantity", "Choose how many you need, then add the part."],
  ["Part added", "Your list now contains the part and its quantity."],
  ["Demo job", "Next, try keeping work organized by room."],
  [
    "Rooms",
    "Open the example floor. This is a practice drawing, not a detection result.",
  ],
  ["Ground floor", "Select a room on the drawing to open its details."],
  ["Mechanical room", "Room notes keep information with the place it belongs."],
  ["Mechanical room", "You can start a material request directly from a room."],
  [
    "Room material list",
    "The title includes the room and date. Parts added here keep their room assignment.",
  ],
  ["Demo job", "Chat keeps the job's conversations together."],
  ["Job Chat", "Send a practice message. It is only visible here."],
  ["You're ready", "You've practiced the main ways to work in ForemanHQ."],
] as const;

const DEMO_JOB = "Riverside Community Centre";
const DEMO_ROOM = "Mechanical room";
const DEMO_PART = '2" XFR 90';
const buttonClass =
  "h-auto min-h-12 w-full whitespace-normal px-4 py-3 text-left";

function Target({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p
        id="tutorial-instruction"
        className="text-primary flex items-center gap-2 text-sm font-semibold"
      >
        <ArrowDown aria-hidden="true" className="size-5 shrink-0" />
        {hint}
      </p>
      <div className={styles.spotlight}>{children}</div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="bg-card space-y-4 rounded-xl border p-4 shadow-sm sm:p-6">
      {children}
    </section>
  );
}

/** A sandboxed practice flow: no real job data, requests, messages or storage. */
export function TutorialExperience({
  onFinish,
  finishing,
  error,
}: {
  onFinish: (outcome: "completed" | "skipped") => void;
  finishing: boolean;
  error?: string | null;
}) {
  const [step, setStep] = useState(0);
  const [date] = useState(() => formatMaterialListDate());
  const [listName, setListName] = useState(date);
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [message, setMessage] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const scrollArea = useRef<HTMLElement>(null);
  const currentStep = STEPS[step] ?? STEPS[0];
  const quantityNumber = Number(quantity);
  const validQuantity =
    Number.isInteger(quantityNumber) &&
    quantityNumber > 0 &&
    quantityNumber <= 999;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [step]);

  function advance(expected: number) {
    if (!finishing)
      setStep((current) =>
        current === expected
          ? Math.min(current + 1, STEPS.length - 1)
          : current,
      );
  }

  function action(
    label: string,
    hint: string,
    expected: number,
    icon?: ReactNode,
  ) {
    return (
      <Target hint={hint}>
        <Button
          type="button"
          className={buttonClass}
          aria-describedby="tutorial-instruction"
          disabled={finishing}
          onClick={() => advance(expected)}
        >
          {icon}
          {label}
        </Button>
      </Target>
    );
  }

  function options(
    expected: number,
    chosen: string,
    choices: string[],
    hint: string,
  ) {
    return (
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          {choices.map((choice) =>
            choice === chosen ? (
              <div key={choice}>{action(choice, hint, expected)}</div>
            ) : (
              <Button
                key={choice}
                type="button"
                variant="outline"
                className={buttonClass}
                disabled
              >
                {choice}
              </Button>
            ),
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Follow the highlighted choice in this practice run.
        </p>
      </Panel>
    );
  }

  function jobOptions(
    expected: number,
    selected: "Material Lists" | "Rooms" | "Chat",
  ) {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold">{DEMO_JOB}</h3>
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
            <MapPin className="size-4" aria-hidden="true" />
            100 Example Street · Demo job
          </p>
        </div>
        {(
          [
            [
              "Material Lists",
              Package,
              step > 12 ? "1 practice list" : "0 lists",
            ],
            ["Rooms", DoorOpen, "3 example rooms"],
            ["Chat", MessageCircle, "Messages for this job"],
          ] as const
        ).map(([label, Icon, description]) => (
          <div key={label}>
            {label === selected ? (
              <Target hint={`Open ${label}`}>
                <Button
                  variant="outline"
                  className={`${buttonClass} justify-start`}
                  disabled={finishing}
                  aria-describedby="tutorial-instruction"
                  onClick={() => advance(expected)}
                >
                  <Icon aria-hidden="true" className="size-5" />
                  <span>
                    <span className="block text-base font-semibold">
                      {label}
                    </span>
                    <span className="text-muted-foreground block text-xs font-normal">
                      {description}
                    </span>
                  </span>
                </Button>
              </Target>
            ) : (
              <Button
                variant="outline"
                className={`${buttonClass} justify-start`}
                disabled
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  }

  let content: ReactNode;
  switch (step) {
    case 0:
      content = (
        <Target hint="Select your job">
          <Button
            variant="outline"
            className={`${buttonClass} justify-start`}
            disabled={finishing}
            aria-describedby="tutorial-instruction"
            onClick={() => advance(0)}
          >
            <span>
              <span className="block text-base font-semibold">{DEMO_JOB}</span>
              <span className="text-muted-foreground mt-1 block text-sm font-normal">
                100 Example Street · Demo job
              </span>
            </span>
          </Button>
        </Target>
      );
      break;
    case 1:
      content = jobOptions(1, "Material Lists");
      break;
    case 2:
      content = (
        <Panel>
          <p className="text-muted-foreground py-4 text-center text-sm">
            No material lists yet.
          </p>
          {action(
            "New material list",
            "Create your first list",
            2,
            <Plus aria-hidden="true" />,
          )}
        </Panel>
      );
      break;
    case 3:
      content = (
        <Panel>
          <Target hint="Name your list, then create it">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (listName.trim()) advance(3);
              }}
            >
              <label className="block space-y-2">
                <span className="text-sm font-medium">List name</span>
                <Input
                  value={listName}
                  maxLength={120}
                  required
                  disabled={finishing}
                  onChange={(event) => setListName(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                className={buttonClass}
                disabled={finishing || !listName.trim()}
              >
                Create list
              </Button>
            </form>
          </Target>
        </Panel>
      );
      break;
    case 4:
      content = (
        <Panel>
          <h3 className="font-semibold">{listName}</h3>
          <p className="text-muted-foreground py-4 text-center text-sm">
            Your list is empty.
          </p>
          {action(
            "Add Part",
            "Add a part to your list",
            4,
            <Plus aria-hidden="true" />,
          )}
        </Panel>
      );
      break;
    case 5:
      content = options(
        5,
        "Plumbing",
        ["Plumbing", "Tools"],
        "Choose Plumbing",
      );
      break;
    case 6:
      content = options(
        6,
        "PVC",
        ["PVC", "Copper", "Cast iron"],
        "Open the PVC group",
      );
      break;
    case 7:
      content = options(
        7,
        "XFR",
        ["XFR", "PVC DWV", "Gasketed SDR"],
        "Choose XFR",
      );
      break;
    case 8:
      content = options(8, '2"', ['2"', '3"', '4"'], "Choose 2-inch");
      break;
    case 9:
      content = options(9, "Fittings", ["Fittings", "Pipe"], "Choose Fittings");
      break;
    case 10:
      content = options(
        10,
        DEMO_PART,
        [DEMO_PART, '2" XFR 45', '2" XFR Coupling'],
        "Choose the 90-degree fitting",
      );
      break;
    case 11:
      content = (
        <Panel>
          <h3 className="font-semibold">{DEMO_PART}</h3>
          <Target hint="Set a quantity and add to your list">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (validQuantity) advance(11);
              }}
            >
              <label className="block space-y-2">
                <span className="text-sm font-medium">Quantity</span>
                <Input
                  type="number"
                  min="1"
                  max="999"
                  step="1"
                  inputMode="numeric"
                  value={quantity}
                  disabled={finishing}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                className={buttonClass}
                disabled={finishing || !validQuantity}
              >
                Add to list
              </Button>
            </form>
          </Target>
        </Panel>
      );
      break;
    case 12:
      content = (
        <Panel>
          <h3 className="font-semibold">{listName}</h3>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span>{DEMO_PART}</span>
            <span className="shrink-0 font-semibold">Qty {quantityNumber}</span>
          </div>
          <p className="text-muted-foreground flex gap-2 text-sm">
            <Check aria-hidden="true" className="size-4 shrink-0" />
            Added to this practice list.
          </p>
          {action("Back to job", "Next, explore rooms", 12)}
        </Panel>
      );
      break;
    case 13:
      content = jobOptions(13, "Rooms");
      break;
    case 14:
      content = (
        <Panel>
          {action(
            "Ground floor · 3 rooms",
            "Open the example floor",
            14,
            <DoorOpen aria-hidden="true" />,
          )}
        </Panel>
      );
      break;
    case 15:
      content = (
        <Panel>
          <Target hint="Select Mechanical room">
            <div className="relative aspect-[5/3] w-full overflow-hidden rounded-md border bg-white">
              <svg
                viewBox="0 0 400 240"
                className="h-full w-full"
                role="img"
                aria-label="Example floor with a mechanical room, office and hallway"
              >
                <rect
                  x="20"
                  y="20"
                  width="360"
                  height="200"
                  fill="#fafafa"
                  stroke="#1f2937"
                  strokeWidth="6"
                />
                <path
                  d="M170 20V135M20 135H100M130 135H380M260 20V105"
                  fill="none"
                  stroke="#1f2937"
                  strokeWidth="5"
                />
                <path
                  d="M100 135V105M100 105Q130 105 130 135"
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth="1.5"
                />
                <rect x="24" y="24" width="142" height="107" fill="#dbeafe" />
                <text x="277" y="82" fontSize="15" fill="#374151">
                  Office
                </text>
                <text x="165" y="185" fontSize="15" fill="#374151">
                  Hallway
                </text>
              </svg>
              <button
                type="button"
                className="absolute top-[10%] left-[6%] flex h-[44%] w-[35%] items-center justify-center rounded border-2 border-blue-700 px-1 text-center text-xs font-semibold text-blue-900 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:text-base"
                aria-describedby="tutorial-instruction"
                disabled={finishing}
                onClick={() => advance(15)}
              >
                {DEMO_ROOM}
              </button>
            </div>
          </Target>
          <p className="text-muted-foreground text-xs">
            Sample drawing with rooms prepared for this tutorial.
          </p>
        </Panel>
      );
      break;
    case 16:
      content = (
        <Panel>
          <Target hint="Write a short note and save it">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!finishing && note.trim()) {
                  setSavedNote(note.trim());
                  advance(16);
                }
              }}
            >
              <label className="block space-y-2">
                <span className="text-sm font-medium">Room notes</span>
                <Textarea
                  value={note}
                  maxLength={1000}
                  rows={4}
                  disabled={finishing}
                  placeholder="e.g. Keep access to the panel clear."
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                className={buttonClass}
                disabled={finishing || !note.trim()}
              >
                Save note
              </Button>
            </form>
          </Target>
        </Panel>
      );
      break;
    case 17:
      content = (
        <Panel>
          <div>
            <h3 className="text-sm font-semibold">Room notes</h3>
            <p className="mt-2 text-sm break-words whitespace-pre-wrap">
              {savedNote}
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Saved in this tutorial.
            </p>
          </div>
          {action(
            "Request material",
            "Create a list for this room",
            17,
            <Package aria-hidden="true" />,
          )}
        </Panel>
      );
      break;
    case 18:
      content = (
        <Panel>
          <h3 className="font-semibold">
            {DEMO_ROOM} — {date}
          </h3>
          <p className="text-muted-foreground text-sm">Room: {DEMO_ROOM}</p>
          <p className="text-sm">
            Use Add Part here just as you did before. The room is recorded on
            each part automatically.
          </p>
          {action("Back to job", "Next, try job chat", 18)}
        </Panel>
      );
      break;
    case 19:
      content = jobOptions(19, "Chat");
      break;
    case 20:
      content = (
        <Panel>
          <p className="text-muted-foreground text-center text-xs">
            Practice chat · No messages or notifications leave this tutorial.
          </p>
          <div className="bg-muted max-w-[85%] rounded-xl p-3 text-sm">
            <p className="mb-1 text-xs font-semibold">Demo teammate</p>Welcome
            to the job! Try sending a quick update.
          </div>
          <Target hint="Write and send a practice message">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!finishing && message.trim()) {
                  setSentMessage(message.trim());
                  advance(20);
                }
              }}
            >
              <label className="block space-y-2">
                <span className="text-sm font-medium">Message</span>
                <Textarea
                  value={message}
                  maxLength={1000}
                  rows={3}
                  disabled={finishing}
                  placeholder="e.g. Materials are ready for the morning."
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                className={buttonClass}
                disabled={finishing || !message.trim()}
              >
                <Send aria-hidden="true" />
                Send practice message
              </Button>
            </form>
          </Target>
        </Panel>
      );
      break;
    default:
      content = (
        <Panel>
          <div className="bg-primary text-primary-foreground ml-auto max-w-[85%] rounded-xl p-3">
            <p className="mb-1 text-xs font-semibold">You · practice message</p>
            <p className="text-sm break-words whitespace-pre-wrap">
              {sentMessage}
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            <li>✓ Created a material list and added a part</li>
            <li>✓ Saved a room note and started a room request</li>
            <li>✓ Sent a practice chat message</li>
          </ul>
          <p className="text-muted-foreground text-sm">
            Your practice work stays here. Finish to open your real workspace.
          </p>
          <Target hint="Finish and open ForemanHQ">
            <Button
              className={buttonClass}
              disabled={finishing}
              aria-describedby="tutorial-instruction"
              onClick={() => onFinish("completed")}
            >
              {finishing ? "Finishing…" : "Finish tutorial"}
            </Button>
          </Target>
        </Panel>
      );
  }

  return (
    <div
      className="bg-background text-foreground fixed inset-0 z-[80] flex h-dvh flex-col"
      aria-label="ForemanHQ guided tutorial"
      aria-busy={finishing}
    >
      <header className="bg-card flex shrink-0 items-center justify-between gap-3 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-6">
        <div>
          <span className="text-lg font-bold">ForemanHQ</span>
          <span className="bg-muted ml-2 rounded px-2 py-1 text-xs font-medium">
            Practice
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={finishing}
          onClick={() =>
            onFinish(step === STEPS.length - 1 ? "completed" : "skipped")
          }
        >
          End tutorial
        </Button>
      </header>
      <main
        ref={scrollArea}
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6"
      >
        <div className="mx-auto w-full max-w-xl space-y-6">
          <div className="space-y-3">
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span>Guided practice</span>
              <span>
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
            <progress
              value={step + 1}
              max={STEPS.length}
              aria-label="Tutorial progress"
              className="accent-primary h-1.5 w-full"
            />
            <h1
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-bold outline-none"
            >
              {currentStep[0]}
            </h1>
            <p className="text-muted-foreground text-sm">{currentStep[1]}</p>
          </div>
          {error && (
            <p
              role="alert"
              className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
            >
              {error}
            </p>
          )}
          {content}
        </div>
      </main>
    </div>
  );
}
