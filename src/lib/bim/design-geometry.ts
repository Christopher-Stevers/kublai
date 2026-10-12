import * as THREE from "three";
import type { DesignElement } from "./design";
import { dimensionGraphic } from "./cad-dimensions";
export function designObject(element: DesignElement): THREE.Group {
  const group = new THREE.Group();
  group.userData.designId = element.id;
  const material = new THREE.MeshStandardMaterial({
    color: element.color,
    roughness: 0.5,
    metalness: 0.25,
    flatShading: element.kind === "solid",
  });
  const add = (
    geometry: THREE.BufferGeometry,
    position?: THREE.Vector3,
    rotation?: THREE.Euler,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.copy(position);
    if (rotation) mesh.rotation.copy(rotation);
    group.add(mesh);
  };
  const [w, h, d] = element.size,
    r = element.diameter / 2;
  switch (element.kind) {
    case "dimension":
      material.dispose();
      group.add(dimensionGraphic(element));
      break;
    case "solid": {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(element.mesh?.positions ?? [], 3),
      );
      geometry.setIndex(element.mesh?.indices ?? []);
      geometry.computeVertexNormals();
      add(geometry);
      break;
    }
    case "line":
    case "polyline":
    case "rectangle":
    case "circle": {
      material.dispose();
      group.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(
            (element.points ?? []).map((p) => new THREE.Vector3(...p)),
          ),
          new THREE.LineBasicMaterial({ color: element.color }),
        ),
      );
      break;
    }
    case "profile": {
      const shape = new THREE.Shape(
        (element.points ?? []).map((p) => new THREE.Vector2(p[0], p[1])),
      );
      add(
        new THREE.ExtrudeGeometry(shape, {
          depth: h,
          bevelEnabled: false,
          steps: 1,
        }),
      );
      break;
    }
    case "pipe":
      add(new THREE.CylinderGeometry(r, r, h, 24));
      break;
    case "elbow": {
      const radius = Math.max(r * 2, h / 2);
      const curve = new THREE.CatmullRomCurve3(
        Array.from({ length: 17 }, (_, i) => {
          const angle = ((i / 16) * Math.PI) / 2;
          return new THREE.Vector3(
            radius * Math.cos(angle) - radius / 2,
            radius * Math.sin(angle) - radius / 2,
            0,
          );
        }),
      );
      const tube = new THREE.TubeGeometry(curve, 32, r, 16, false);
      const positions = Array.from(tube.getAttribute("position").array),
        indices = Array.from(tube.index!.array);
      for (const end of [0, 1]) {
        const centre = curve.getPointAt(end),
          normal = curve.getTangentAt(end).multiplyScalar(end ? 1 : -1),
          middle = positions.length / 3,
          ring = end * 32 * 17;
        positions.push(centre.x, centre.y, centre.z);
        for (let i = 0; i < 16; i++) {
          const a = new THREE.Vector3()
              .fromArray(positions, (ring + i) * 3)
              .sub(centre),
            b = new THREE.Vector3()
              .fromArray(positions, (ring + i + 1) * 3)
              .sub(centre);
          if (a.cross(b).dot(normal) > 0)
            indices.push(middle, ring + i, ring + i + 1);
          else indices.push(middle, ring + i + 1, ring + i);
        }
      }
      tube.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      tube.deleteAttribute("normal");
      tube.deleteAttribute("uv");
      tube.setIndex(indices);
      tube.computeVertexNormals();
      add(tube);
      break;
    }
    case "tee":
      add(new THREE.CylinderGeometry(r, r, h, 24));
      add(
        new THREE.CylinderGeometry(r, r, h / 2, 24),
        new THREE.Vector3(h / 4, 0, 0),
        new THREE.Euler(0, 0, Math.PI / 2),
      );
      break;
    case "valve":
      add(new THREE.CylinderGeometry(r, r, h, 24));
      add(new THREE.SphereGeometry(r * 1.8, 20, 12));
      add(
        new THREE.TorusGeometry(r * 2, r * 0.2, 8, 24),
        new THREE.Vector3(0, 0, r * 3),
      );
      break;
    case "tank":
      add(new THREE.CylinderGeometry(w / 2, w / 2, h, 32));
      break;
    case "pump":
      add(
        new THREE.CylinderGeometry(w / 2, w / 2, h * 0.7, 24),
        undefined,
        new THREE.Euler(Math.PI / 2, 0, 0),
      );
      add(
        new THREE.BoxGeometry(w, h * 0.2, d),
        new THREE.Vector3(0, -h * 0.45, 0),
      );
      break;
    default:
      add(new THREE.BoxGeometry(w, h, d));
  }
  group.position.fromArray(element.position);
  group.rotation.set(
    ...(element.rotation.map(THREE.MathUtils.degToRad) as [
      number,
      number,
      number,
    ]),
  );
  if (element.scale) group.scale.fromArray(element.scale);
  return group;
}
export function disposeDesignObject(object: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  object.traverse((o) => {
    if (
      o instanceof THREE.Mesh ||
      o instanceof THREE.Line ||
      o instanceof THREE.Sprite
    ) {
      const mesh = o as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        materials.add(m);
    }
  });
  materials.forEach((m) => {
    const map = (m as THREE.SpriteMaterial).map;
    map?.dispose();
    m.dispose();
  });
}
