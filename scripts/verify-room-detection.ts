import { createCanvas } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";

import {
  findRoomAtPoint,
  pointInPolygon,
  type RoomPolygonShape,
} from "../src/lib/room-shape";
import {
  buildFloorGraph,
  detectFloorRooms,
  facesAtPoint,
} from "../src/server/rooms/floor-graph";
import {
  extractPdfLabels,
  extractPdfLinework,
  extractPdfRoomSeeds,
} from "../src/server/rooms/pdf-walls";
import { buildWallLinework } from "../src/server/rooms/wall-lines";

const [
  pdfPath,
  pagesArg = "1",
  outputDir = ".tmp/room-verification",
  expectationsPath,
] = process.argv.slice(2);
if (!pdfPath) {
  throw new Error(
    "Usage: pnpm tsx scripts/verify-room-detection.ts <pdf> <pages> [output-dir] [expectations.json]",
  );
}

const pdf = await readFile(pdfPath);
const expectations = expectationsPath
  ? (JSON.parse((await readFile(expectationsPath)).toString("utf8")) as {
      pages: Array<{
        page: number;
        rooms: Array<{
          name: string;
          inside: Array<{ x: number; y: number }>;
          outside?: Array<{ x: number; y: number }>;
          boundary?: Array<{ x: number; y: number }>;
          maxBoundaryDistance?: number;
          minIntersectionOverUnion?: number;
          maxOutsideAreaRatio?: number;
          maxMissingAreaRatio?: number;
          maxWallCrossings?: number;
        }>;
      }>;
    })
  : null;
const document = await getDocument({
  data: new Uint8Array(pdf),
  useSystemFonts: true,
}).promise;
const requestedPages = pagesArg
  .split(",")
  .map(Number)
  .filter((page) => Number.isInteger(page) && page >= 1);

function pointToSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared,
          ),
        );
  return Math.hypot(
    point.x - (start.x + along * dx),
    point.y - (start.y + along * dy),
  );
}

function polygonArea(points: Array<{ x: number; y: number }>) {
  let area = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    area += point.x * next.y - next.x * point.y;
  });
  return Math.abs(area) / 2;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function roomClickPoints(shape: RoomPolygonShape) {
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const points: Array<{ x: number; y: number }> = [];
  for (let row = 1; row < 20; row += 1) {
    for (let column = 1; column < 20; column += 1) {
      const point = {
        x: left + ((right - left) * column) / 20,
        y: top + ((bottom - top) * row) / 20,
      };
      if (pointInPolygon(point, shape)) points.push(point);
    }
  }
  return points;
}

function nearestFaces(
  graph: ReturnType<typeof buildFloorGraph>,
  point: { x: number; y: number },
) {
  return graph.faces
    .filter((face) => !face.outside)
    .map((face) => ({
      face,
      distance: Math.min(
        ...face.shape.points.map((start, index) =>
          pointToSegmentDistance(
            point,
            start,
            face.shape.points[(index + 1) % face.shape.points.length]!,
          ),
        ),
      ),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3);
}

await mkdir(outputDir, { recursive: true });
console.log(JSON.stringify({ pdf: pdfPath, pages: document.numPages }));

for (const pageNumber of requestedPages) {
  if (pageNumber > document.numPages) {
    console.log(JSON.stringify({ page: pageNumber, skipped: "out of range" }));
    continue;
  }
  const messages: string[] = [];
  const [linework, labels] = await Promise.all([
    extractPdfLinework(pdf, pageNumber),
    extractPdfLabels(pdf, pageNumber),
  ]);
  const seeds = extractPdfRoomSeeds(labels);
  const graph = buildFloorGraph(linework, {
    log: (message) => messages.push(message),
  });
  const legacySeeds = seeds
    .slice(0, 40)
    .filter((seed) =>
      [seed, ...(seed.anchors ?? [])].some(
        (point) => facesAtPoint(graph, point).length > 0,
      ),
    );
  const legacyRooms = detectFloorRooms(
    linework,
    legacySeeds,
    undefined,
    graph,
  ).rooms;
  const rooms = detectFloorRooms(
    linework,
    seeds,
    (message) => messages.push(message),
    graph,
  ).rooms;
  const legacyFaceIds = new Set(legacyRooms.flatMap((room) => room.faceIds));
  const roomFaceIds = new Set(rooms.flatMap((room) => room.faceIds));
  const eligibleFaces = graph.faces.filter((face) => !face.outside);
  const faceCoverage = (
    faceIds: Set<number>,
    include: (face: (typeof graph.faces)[number]) => boolean = () => true,
  ) => {
    const faces = eligibleFaces.filter(include);
    const eligibleArea = faces.reduce((sum, face) => sum + face.area, 0);
    const detectedArea = faces.reduce(
      (sum, face) => sum + (faceIds.has(face.id) ? face.area : 0),
      0,
    );
    return eligibleArea > 0
      ? Number((detectedArea / eligibleArea).toFixed(4))
      : 0;
  };
  const missingSeeds = seeds.filter(
    (seed) =>
      !rooms.some(
        (room) =>
          room.name === seed.name &&
          Math.hypot(room.seed.x - seed.x, room.seed.y - seed.y) < 0.000001,
      ),
  );
  const clickable = rooms.filter((room) =>
    roomClickPoints(room.shape).some(
      (point) => findRoomAtPoint(rooms, point) === room,
    ),
  ).length;
  const unclickable = rooms
    .filter(
      (room) =>
        !roomClickPoints(room.shape).some(
          (point) => findRoomAtPoint(rooms, point) === room,
        ),
    )
    .map((room) => room.name);
  const unitsWithAreas = rooms.flatMap((room) => {
    if (room.kind !== "unit") return [];
    const seed = seeds.find(
      (candidate) =>
        candidate.kind === "unit" &&
        candidate.name === room.name &&
        Math.hypot(candidate.x - room.seed.x, candidate.y - room.seed.y) <
          0.000001,
    );
    if (!seed?.areaSqFt) return [];
    return [
      {
        name: room.name,
        basis: room.basis ?? "global-graph",
        squareFeet: seed.areaSqFt,
        faceArea: room.faceIds.reduce(
          (sum, faceId) => sum + graph.faces[faceId]!.area,
          0,
        ),
        polygonArea: polygonArea(room.shape.points),
      },
    ];
  });
  const referenceAreaPerSquareFoot = median(
    unitsWithAreas.map((unit) => unit.polygonArea / unit.squareFeet),
  );
  const unitAreaChecks = unitsWithAreas.map((unit) => {
    const ratio = referenceAreaPerSquareFoot
      ? unit.polygonArea / unit.squareFeet / referenceAreaPerSquareFoot
      : 0;
    const unionAreaRatio = unit.polygonArea / unit.faceArea;
    return {
      name: unit.name,
      ratio: Number(ratio.toFixed(2)),
      unionAreaRatio: Number(unionAreaRatio.toFixed(3)),
      withinReferenceRange: ratio >= 0.45 && ratio <= 1.35,
      withinUnionRange: unit.basis !== "global-graph" || unionAreaRatio <= 1.15,
    };
  });
  if (
    unitAreaChecks.some(
      (check) => !check.withinReferenceRange || !check.withinUnionRange,
    )
  ) {
    process.exitCode = 1;
  }
  const pageExpectations = expectations?.pages.find(
    (expected) => expected.page === pageNumber,
  );
  const strongWalls = buildWallLinework(linework.segments).strong;
  const properWallCrossings = (shape: RoomPolygonShape) => {
    let crossings = 0;
    shape.points.forEach((start, index) => {
      const end = shape.points[(index + 1) % shape.points.length]!;
      const midpoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
      const supported = strongWalls.some(
        (wall) =>
          pointToSegmentDistance(
            midpoint,
            { x: wall[0][0], y: wall[0][1] },
            { x: wall[1][0], y: wall[1][1] },
          ) <= 0.0025,
      );
      if (supported) return;
      const rx = end.x - start.x;
      const ry = end.y - start.y;
      for (const [[x1, y1], [x2, y2]] of strongWalls) {
        const sx = x2 - x1;
        const sy = y2 - y1;
        const denominator = rx * sy - ry * sx;
        if (Math.abs(denominator) < 1e-9) continue;
        const qx = x1 - start.x;
        const qy = y1 - start.y;
        const alongRoom = (qx * sy - qy * sx) / denominator;
        const alongWall = (qx * ry - qy * rx) / denominator;
        if (
          alongRoom > 0.02 &&
          alongRoom < 0.98 &&
          alongWall > 0.02 &&
          alongWall < 0.98
        ) {
          crossings += 1;
        }
      }
    });
    return crossings;
  };
  const geometryReader = new GeoJSONReader(new GeometryFactory());
  const roomGeometry = (shape: RoomPolygonShape) =>
    geometryReader.read({
      type: "Polygon",
      coordinates: [
        [
          ...shape.points.map((point) => [point.x, point.y]),
          [shape.points[0]!.x, shape.points[0]!.y],
        ],
      ],
    });
  const boundaryDistance = (
    point: { x: number; y: number },
    boundary: Array<{ x: number; y: number }>,
  ) =>
    Math.min(
      ...boundary.map((start, index) =>
        pointToSegmentDistance(
          point,
          start,
          boundary[(index + 1) % boundary.length]!,
        ),
      ),
    );
  const sampledBoundary = (boundary: Array<{ x: number; y: number }>) =>
    boundary.flatMap((start, index) => {
      const end = boundary[(index + 1) % boundary.length]!;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const samples = Math.max(1, Math.ceil(length / 0.001));
      return Array.from({ length: samples }, (_, sample) => ({
        x: start.x + ((end.x - start.x) * sample) / samples,
        y: start.y + ((end.y - start.y) * sample) / samples,
      }));
    });
  const outlineChecks = (pageExpectations?.rooms ?? []).map((expected) => {
    const room = rooms.find((candidate) => candidate.name === expected.name);
    const covered = room
      ? expected.inside.filter((point) => pointInPolygon(point, room.shape))
          .length
      : 0;
    const outsideIncluded = room
      ? (expected.outside ?? []).filter((point) =>
          pointInPolygon(point, room.shape),
        )
      : [];
    const boundaryHausdorff =
      room && expected.boundary?.length
        ? Math.max(
            ...sampledBoundary(room.shape.points).map((point) =>
              boundaryDistance(point, expected.boundary!),
            ),
            ...sampledBoundary(expected.boundary).map((point) =>
              boundaryDistance(point, room.shape.points),
            ),
          )
        : null;
    const fullOutline = (() => {
      if (!room || !expected.boundary?.length) return null;
      try {
        const detected = roomGeometry(room.shape);
        const gold = roomGeometry({
          type: "polygon",
          points: expected.boundary,
        });
        const intersectionArea = OverlayOp.intersection(
          detected,
          gold,
        ).getArea();
        const detectedArea = detected.getArea();
        const goldArea = gold.getArea();
        const unionArea = detectedArea + goldArea - intersectionArea;
        return {
          intersectionOverUnion:
            unionArea > 0 ? intersectionArea / unionArea : 0,
          outsideAreaRatio:
            goldArea > 0 ? (detectedArea - intersectionArea) / goldArea : 1,
          missingAreaRatio:
            goldArea > 0 ? (goldArea - intersectionArea) / goldArea : 1,
        };
      } catch {
        return {
          intersectionOverUnion: 0,
          outsideAreaRatio: 1,
          missingAreaRatio: 1,
        };
      }
    })();
    const maxBoundaryDistance = expected.maxBoundaryDistance ?? 0.004;
    const overlaps = room
      ? rooms.flatMap((other) => {
          if (
            other === room ||
            !(pageExpectations?.rooms ?? []).some(
              (candidate) => candidate.name === other.name,
            )
          ) {
            return [];
          }
          try {
            const area = OverlayOp.intersection(
              roomGeometry(room.shape),
              roomGeometry(other.shape),
            ).getArea();
            return area > 1e-8
              ? [{ name: other.name, area: Number(area.toFixed(8)) }]
              : [];
          } catch {
            return [{ name: `${other.name} (invalid geometry)`, area: -1 }];
          }
        })
      : [];
    const wallCrossings = room ? properWallCrossings(room.shape) : null;
    return {
      name: expected.name,
      covered,
      total: expected.inside.length,
      outsideIncluded,
      boundaryHausdorff:
        boundaryHausdorff === null
          ? null
          : Number(boundaryHausdorff.toFixed(6)),
      maxBoundaryDistance: expected.boundary?.length
        ? maxBoundaryDistance
        : null,
      intersectionOverUnion:
        fullOutline === null
          ? null
          : Number(fullOutline.intersectionOverUnion.toFixed(4)),
      minIntersectionOverUnion: expected.minIntersectionOverUnion ?? null,
      outsideAreaRatio:
        fullOutline === null
          ? null
          : Number(fullOutline.outsideAreaRatio.toFixed(4)),
      maxOutsideAreaRatio: expected.maxOutsideAreaRatio ?? null,
      missingAreaRatio:
        fullOutline === null
          ? null
          : Number(fullOutline.missingAreaRatio.toFixed(4)),
      maxMissingAreaRatio: expected.maxMissingAreaRatio ?? null,
      overlaps,
      wallCrossings,
      maxWallCrossings: expected.maxWallCrossings ?? null,
      missed: room
        ? expected.inside
            .filter((point) => !pointInPolygon(point, room.shape))
            .map((point) => ({
              ...point,
              containingRooms: rooms
                .filter((candidate) => pointInPolygon(point, candidate.shape))
                .map((candidate) => candidate.name),
              faces: facesAtPoint(graph, point).map((face) => ({
                id: face.id,
                space: face.space,
                area: Number(face.area.toFixed(6)),
                outside: face.outside,
                spaceFaces: graph.spaces[face.space]!.faceIds,
                spaceArea: Number(graph.spaces[face.space]!.area.toFixed(6)),
                adjacentRoomNames: [
                  ...new Set(
                    graph.spaces[face.space]!.faceIds.flatMap((faceId) =>
                      graph.faces[faceId]!.neighbors.flatMap((neighbor) =>
                        rooms
                          .filter((candidate) =>
                            candidate.faceIds.includes(neighbor.face),
                          )
                          .map((candidate) => candidate.name),
                      ),
                    ),
                  ),
                ],
                seedNamesInSpace: seeds
                  .filter((seed) =>
                    [seed, ...(seed.anchors ?? [])].some((anchor) =>
                      facesAtPoint(graph, anchor).some(
                        (candidate) => candidate.space === face.space,
                      ),
                    ),
                  )
                  .map((seed) => seed.name),
                spaceNeighbors: graph.spaces[face.space]!.faceIds.flatMap(
                  (faceId) =>
                    graph.faces[faceId]!.neighbors.filter(
                      (neighbor) =>
                        graph.faces[neighbor.face]!.space !== face.space,
                    ).map((neighbor) => ({
                      face: neighbor.face,
                      space: graph.faces[neighbor.face]!.space,
                      length: Number(neighbor.length.toFixed(6)),
                      wall: Number(neighbor.wallLength.toFixed(6)),
                      owners: rooms
                        .filter((candidate) =>
                          candidate.faceIds.includes(neighbor.face),
                        )
                        .map((candidate) => candidate.name),
                    })),
                ),
                neighbors: face.neighbors.map((neighbor) => ({
                  face: neighbor.face,
                  space: graph.faces[neighbor.face]!.space,
                  length: Number(neighbor.length.toFixed(6)),
                  wall: Number(neighbor.wallLength.toFixed(6)),
                  owners: rooms
                    .filter((candidate) =>
                      candidate.faceIds.includes(neighbor.face),
                    )
                    .map((candidate) => candidate.name),
                })),
              })),
            }))
        : expected.inside,
      passed:
        covered === expected.inside.length &&
        outsideIncluded.length === 0 &&
        overlaps.length === 0 &&
        (expected.maxWallCrossings === undefined ||
          (wallCrossings ?? Number.POSITIVE_INFINITY) <=
            expected.maxWallCrossings) &&
        (boundaryHausdorff === null ||
          boundaryHausdorff <= maxBoundaryDistance) &&
        (expected.minIntersectionOverUnion === undefined ||
          (fullOutline?.intersectionOverUnion ?? 0) >=
            expected.minIntersectionOverUnion) &&
        (expected.maxOutsideAreaRatio === undefined ||
          (fullOutline?.outsideAreaRatio ?? Number.POSITIVE_INFINITY) <=
            expected.maxOutsideAreaRatio) &&
        (expected.maxMissingAreaRatio === undefined ||
          (fullOutline?.missingAreaRatio ?? Number.POSITIVE_INFINITY) <=
            expected.maxMissingAreaRatio),
    };
  });
  if (outlineChecks.some((check) => !check.passed)) process.exitCode = 1;
  const largestRooms = rooms
    .map((room) => ({
      name: room.name,
      area: polygonArea(room.shape.points),
    }))
    .sort((left, right) => right.area - left.area)
    .slice(0, 5)
    .map((room) => ({ ...room, area: Number(room.area.toFixed(5)) }));

  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height)),
  );
  const context = canvas.getContext("2d");
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  rooms.forEach((room, index) => {
    const [first, ...rest] = room.shape.points;
    if (!first) return;
    context.beginPath();
    context.moveTo(first.x * canvas.width, first.y * canvas.height);
    rest.forEach((point) =>
      context.lineTo(point.x * canvas.width, point.y * canvas.height),
    );
    context.closePath();
    context.fillStyle = `hsla(${(index * 137.5) % 360}, 80%, 55%, 0.3)`;
    context.strokeStyle = `hsl(${(index * 137.5) % 360}, 80%, 35%)`;
    context.lineWidth = 2;
    context.fill();
    context.stroke();
  });
  for (const expected of pageExpectations?.rooms ?? []) {
    expected.inside.forEach((point, index) => {
      context.beginPath();
      context.arc(
        point.x * canvas.width,
        point.y * canvas.height,
        5,
        0,
        Math.PI * 2,
      );
      context.fillStyle = "#ffffff";
      context.fill();
      context.strokeStyle = "#111827";
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = "#111827";
      context.font = "bold 12px sans-serif";
      context.fillText(
        `${expected.name}.${index + 1}`,
        point.x * canvas.width + 7,
        point.y * canvas.height - 7,
      );
    });
    expected.outside?.forEach((point, index) => {
      context.beginPath();
      context.moveTo(point.x * canvas.width - 6, point.y * canvas.height - 6);
      context.lineTo(point.x * canvas.width + 6, point.y * canvas.height + 6);
      context.moveTo(point.x * canvas.width + 6, point.y * canvas.height - 6);
      context.lineTo(point.x * canvas.width - 6, point.y * canvas.height + 6);
      context.strokeStyle = "#dc2626";
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = "#991b1b";
      context.fillText(
        `${expected.name}.outside.${index + 1}`,
        point.x * canvas.width + 8,
        point.y * canvas.height + 8,
      );
    });
    if (expected.boundary?.length) {
      context.beginPath();
      expected.boundary.forEach((point, index) => {
        if (index === 0)
          context.moveTo(point.x * canvas.width, point.y * canvas.height);
        else context.lineTo(point.x * canvas.width, point.y * canvas.height);
      });
      context.closePath();
      context.strokeStyle = "#2563eb";
      context.lineWidth = 2;
      context.stroke();
    }
  }
  const output = path.join(
    outputDir,
    `${path.basename(pdfPath, path.extname(pdfPath))}-page-${pageNumber}.png`,
  );
  await writeFile(output, canvas.toBuffer("image/png"));
  console.log(
    JSON.stringify({
      page: pageNumber,
      segments: linework.segments.length,
      labels: labels.length,
      seeds: seeds.length,
      faces: graph.faces.length,
      spaces: graph.spaces.length,
      legacySeedCap: 40,
      legacyRooms: legacyRooms.length,
      legacyCoverage: {
        fullSheet: faceCoverage(legacyFaceIds),
        upperRight: faceCoverage(
          legacyFaceIds,
          (face) => face.centroid.x >= 0.5 && face.centroid.y < 0.5,
        ),
        lowerHalf: faceCoverage(
          legacyFaceIds,
          (face) => face.centroid.y >= 0.5,
        ),
      },
      rooms: rooms.length,
      unitSeeds: seeds.filter((seed) => seed.kind === "unit").length,
      unitRooms: rooms.filter((room) => room.kind === "unit").length,
      missingSeeds: missingSeeds.length,
      missingSeedDetails: missingSeeds.map((seed) => ({
        nearest: (() => {
          const matches = nearestFaces(graph, seed);
          return matches.map((match) => ({
            distance: Number(match.distance.toFixed(5)),
            face: match.face.id,
            area: Number(match.face.area.toFixed(6)),
            space: match.face.space,
            corridorLike: match.face.corridorLike,
          }));
        })(),
        name: seed.name,
        x: Number(seed.x.toFixed(4)),
        y: Number(seed.y.toFixed(4)),
        containingFaces: facesAtPoint(graph, seed).length,
        anchorFaces: (seed.anchors ?? []).map(
          (anchor) => facesAtPoint(graph, anchor).length,
        ),
      })),
      coverage: {
        fullSheet: faceCoverage(roomFaceIds),
        upperRight: faceCoverage(
          roomFaceIds,
          (face) => face.centroid.x >= 0.5 && face.centroid.y < 0.5,
        ),
        lowerHalf: faceCoverage(roomFaceIds, (face) => face.centroid.y >= 0.5),
      },
      clickable,
      unclickable,
      unitAreaScale: {
        reference: Number(referenceAreaPerSquareFoot.toFixed(9)),
        withinRange: unitAreaChecks.filter(
          (check) => check.withinReferenceRange,
        ).length,
        total: unitAreaChecks.length,
        checks: unitAreaChecks,
      },
      outlineChecks,
      largestRooms,
      maxCorners: Math.max(0, ...rooms.map((room) => room.shape.points.length)),
      names: rooms.map((room) => room.name),
      overlay: output,
      diagnostics: messages.slice(0, 20),
    }),
  );
}

await document.cleanup();
