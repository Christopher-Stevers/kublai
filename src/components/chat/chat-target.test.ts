import { expect, it } from "vitest";
import { validChatTarget } from "./chat-target";
it("retains existing-chat, direct-recipient and named-group validation", () => {
  expect(validChatTarget({mode:"existing",conversationId:""})).toBe(false);
  expect(validChatTarget({mode:"existing",conversationId:"chat"})).toBe(true);
  expect(validChatTarget({mode:"direct",recipientIds:["one"],name:""})).toBe(true);
  expect(validChatTarget({mode:"direct",recipientIds:["one","two"],name:""})).toBe(false);
  expect(validChatTarget({mode:"group",recipientIds:["one","two"],name:" "})).toBe(false);
  expect(validChatTarget({mode:"group",recipientIds:["one","two"],name:"Crew"})).toBe(true);
  expect(validChatTarget({mode:"group",recipientIds:Array.from({length:50},(_,i)=>String(i)),name:"Crew"})).toBe(false);
});
