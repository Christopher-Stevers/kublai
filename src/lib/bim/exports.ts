import { zipSync, strToU8 } from "fflate";
import { csvCell } from "./geometry";
import type { BimElement, BimIssue, BimModel } from "./types";
export function elementCsv(elements: BimElement[], models: BimModel[]) {
  const names = new Map(models.map((m) => [m.id, `${m.name} · v${m.version}`]));
  return [
    ["Model", "IFC GUID", "Element ID", "Category", "Level", "Name"],
    ...elements.map((e) => [
      names.get(e.modelId) ?? e.modelId,
      e.guid,
      e.expressId,
      e.type,
      e.levelName,
      e.name,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
export function issueCsv(
  issues: BimIssue[],
  members: { id: string; name: string }[],
) {
  const names = new Map(members.map((m) => [m.id, m.name]));
  return [
    [
      "ID",
      "Title",
      "Type",
      "Status",
      "Priority",
      "Assigned to",
      "Due date",
      "Description",
      "Element IFC GUID",
    ],
    ...issues.map((i) => [
      i.id,
      i.title,
      i.kind,
      i.status,
      i.priority,
      names.get(i.assigneeId ?? "") ?? "",
      i.dueDate ?? "",
      i.description,
      i.element?.guid ?? "",
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
const xml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
// web-ifc uses X,Y-up,-Z. BCF is IFC world coordinates (X,Y,Z-up), in metres.
const point = (p: number[]) => `<X>${p[0]}</X><Y>${-p[2]!}</Y><Z>${p[1]}</Z>`;
export function issueBcf(issues: BimIssue[], models: BimModel[]) {
  const files: Record<string, Uint8Array> = {
    "bcf.version": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Version VersionId="2.1"/>',
    ),
  };
  for (const issue of issues) {
    const v = issue.view,
      id = crypto.randomUUID();
    const position = v.position.map((n, i) => n + v.origin[i]!);
    const direction = v.target.map((n, i) => n - v.position[i]!);
    const len = Math.hypot(...direction) || 1;
    const camera = `<CameraViewPoint>${point(position)}</CameraViewPoint><CameraDirection>${point(direction.map((n) => n / len))}</CameraDirection><CameraUpVector>${point(v.up)}</CameraUpVector>`;
    const components = issue.element?.guid
      ? `<Selection><Component IfcGuid="${xml(issue.element.guid)}"/></Selection>`
      : "";
    const header = models
      .filter((m) => v.modelIds.includes(m.id))
      .map(
        (m) =>
          `<File isExternal="false"><Filename>${xml(m.filename)}</Filename><Date>${m.createdAt}</Date></File>`,
      )
      .join("");
    const comments = issue.comments
      .map(
        (c) =>
          `<Comment Guid="${c.id}"><Date>${c.createdAt}</Date><Author>${xml(c.authorName)}</Author><Comment>${xml(c.text)}</Comment><Viewpoint Guid="${id}"/></Comment>`,
      )
      .join("");
    files[`${issue.id}/markup.bcf`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Markup><Header>${header}</Header><Topic Guid="${issue.id}" TopicType="${issue.kind}" TopicStatus="${issue.status}"><Title>${xml(issue.title)}</Title><Priority>${issue.priority}</Priority><CreationDate>${issue.createdAt}</CreationDate><CreationAuthor>${xml(issue.authorName)}</CreationAuthor><Description>${xml(issue.description)}</Description></Topic>${comments}<Viewpoints Guid="${id}"><Viewpoint>viewpoint.bcfv</Viewpoint></Viewpoints></Markup>`,
    );
    files[`${issue.id}/viewpoint.bcfv`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><VisualizationInfo Guid="${id}"><Components>${components}<Visibility DefaultVisibility="true"/></Components>${v.projection === "perspective" ? `<PerspectiveCamera>${camera}<FieldOfView>50</FieldOfView></PerspectiveCamera>` : `<OrthogonalCamera>${camera}<ViewToWorldScale>${v.orthoScale}</ViewToWorldScale></OrthogonalCamera>`}</VisualizationInfo>`,
    );
  }
  return zipSync(files, { level: 6 });
}
