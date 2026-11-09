"use client";

import { CheckIcon, CopyIcon, DownloadIcon, MailIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { openEmailCompose } from "~/lib/mailto";
import type { SupplierClaim } from "~/lib/supplier-claim";

/** The reviewer checks the message and sends it from their own mail app. */
export function SupplierClaimDialog({
  open,
  onOpenChange,
  ...props
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & ClaimProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        // Focusing the To field would cover the message with the phone keyboard.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Email supplier</DialogTitle>
          <DialogDescription>
            Check the message, then send it from your mail app. Attach the slip
            so the supplier can see it.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted on each opening, so it starts from the review as it is now. */}
        <ClaimForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

type ClaimProps = {
  claim: SupplierClaim;
  to: string[];
  slipUrl: string;
  slipName: string;
};
function ClaimForm({ claim, to, slipUrl, slipName }: ClaimProps) {
  const [recipients, setRecipients] = useState(() => to.join(", "));
  const [subject, setSubject] = useState(claim.subject);
  const [body, setBody] = useState(claim.body);
  const [copied, setCopied] = useState(false);
  const addresses = recipients
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  return (
    <>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="claim-to">To</Label>
          <Input
            id="claim-to"
            inputMode="email"
            autoComplete="email"
            placeholder="Supplier email"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
          {!to.length && (
            <p className="text-muted-foreground text-xs">
              No email is saved for this supplier or order.
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="claim-subject">Subject</Label>
          <Input
            id="claim-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="claim-body">Message</Label>
          <Textarea
            id="claim-body"
            className="min-h-64 text-base sm:text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <a
          href={slipUrl}
          download={slipName}
          className="text-primary inline-flex items-center gap-1.5 justify-self-start text-sm font-medium underline-offset-4 hover:underline"
        >
          <DownloadIcon className="size-4" />
          Download the slip to attach
        </a>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(`${subject}\n\n${body}`)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          disabled={!body.trim()}
          onClick={() => {
            // Launch from this tap; Safari blocks it after an await.
            openEmailCompose({ to: addresses, subject, body });
          }}
        >
          <MailIcon className="size-4" />
          Open email
        </Button>
      </DialogFooter>
    </>
  );
}
