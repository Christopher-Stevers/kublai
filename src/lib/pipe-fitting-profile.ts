import type { PipeComponentKind } from "./pipe-components-types";

export type PipeFittingProfile = {
  kind: PipeComponentKind;
  name: string;
  angle?: string;
  direction?: "up" | "down" | "unknown";
  connection: "end" | "through" | "either";
};

/** Interpret a reviewed legend's words, never a project name or layer code. */
export function pipeFittingProfile(value: string): PipeFittingProfile | null {
  const t = value.toUpperCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  if (
    /\b(?:DUCT|AIR|CABLE|CONDUIT|TAG|SCHEMATIC|PITCH|FLOW|VALVE|PROVIDE|SHALL)\b/.test(
      t,
    )
  )
    return null;
  if (/\b(?:CAP|CAPPED|PLUG|PLUGGED)\b/.test(t))
    return {
      kind: "cap",
      name: /\bPLUG/.test(t) ? "Cap / plug" : "Pipe end cap",
      connection: "end",
    };
  const elbow = /\bELBOW|\bBEND/.test(t),
    tee = /\bTEE\b/.test(t);
  const pipe = /\b(?:PIPE|PIPING|RISER)\b/.test(t);
  const connection =
    /\b(?:CONNECT(?:ION)? (?:OUT )?(?:OF )?(?:THE )?(?:TOP|BOTTOM)|(?:TOP|BOTTOM) PIPE CONNECTION)\b/.test(
      t,
    );
  const up = /\b(?:UP|RISE|TOP)\b/.test(t),
    down = /\b(?:DOWN|DN|DROP|BOTTOM)\b/.test(t);
  if (
    !(up || down) ||
    !(
      elbow ||
      tee ||
      pipe ||
      connection ||
      /^(?:DROP OR RISE|RISE OR DROP)$/.test(t.trim())
    )
  )
    return null;
  const direction = up && down ? "unknown" : up ? "up" : "down";
  const angle =
    /\b(90|45|22(?:\.5)?)\s*(?:°|DEG(?:REES)?|ELBOW|BEND)/.exec(t)?.[1] ?? "90";
  const suffix = direction === "unknown" ? "up / down (review)" : direction;
  if (elbow && !tee)
    return {
      kind: "elbow",
      name: `${angle}° elbow ${suffix}`,
      angle,
      direction,
      connection: "end",
    };
  if ((tee && !elbow) || connection)
    return {
      kind: "tee",
      name: `Tee outlet ${suffix}`,
      direction,
      connection: "through",
    };
  return {
    kind: direction === "up" ? "rise" : direction === "down" ? "drop" : "other",
    name:
      direction === "unknown"
        ? "Pipe rise / drop (review)"
        : `Pipe ${direction}`,
    direction,
    angle,
    connection: "either",
  };
}

export function resolvePipeFitting(
  profile: PipeFittingProfile,
  arms: "end" | "through" | "unknown",
): PipeFittingProfile | null {
  if (
    arms === "unknown" ||
    (profile.connection !== "either" && profile.connection !== arms)
  )
    return null;
  if (
    profile.connection !== "either" ||
    !profile.direction ||
    profile.direction === "unknown"
  )
    return profile;
  return {
    ...profile,
    kind: arms === "end" ? "elbow" : "tee",
    connection: arms,
    name:
      arms === "end"
        ? `${profile.angle ?? "90"}° elbow ${profile.direction}`
        : `Tee outlet ${profile.direction}`,
  };
}
