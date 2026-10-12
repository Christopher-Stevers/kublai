import * as THREE from "three";
import type { DesignElement } from "./design";
export function designObject(element: DesignElement): THREE.Group {
  const group = new THREE.Group();
  group.userData.designId = element.id;
  const material = new THREE.MeshStandardMaterial({
    color: element.color,
    roughness: 0.5,
    metalness: 0.25,
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
      add(new THREE.TubeGeometry(curve, 32, r, 16, false));
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
  return group;
}
export function disposeDesignObject(object: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
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
  materials.forEach((m) => m.dispose());
}
