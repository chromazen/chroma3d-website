import type * as Three from "three";

// Original illustrative assembly. It is not a manufactured product or a claim
// of mechanical validation. Coordinates are deliberately presentation units.
export function createAssembly(T: typeof Three) {
  const group = new T.Group();
  const parts: Three.Mesh[] = [];
  const materials = {
    orange: new T.MeshStandardMaterial({
      color: 0xf5682e,
      metalness: 0.08,
      roughness: 0.32,
    }),
    ivory: new T.MeshStandardMaterial({
      color: 0xd9ded4,
      metalness: 0.12,
      roughness: 0.29,
    }),
    graphite: new T.MeshStandardMaterial({
      color: 0x242a29,
      metalness: 0.35,
      roughness: 0.28,
    }),
    metal: new T.MeshStandardMaterial({
      color: 0xa7b1ac,
      metalness: 0.8,
      roughness: 0.21,
    }),
  };
  function gear(
    teeth: number,
    radius: number,
    bore: number,
    depth: number,
    twist: number,
  ) {
    const shape = new T.Shape();
    const profile = [
      [0, 0.89],
      [0.18, 0.89],
      [0.31, 1],
      [0.6, 1],
      [0.76, 0.89],
      [1, 0.89],
    ];
    for (let t = 0; t < teeth; t++)
      for (let j = 0; j < profile.length; j++) {
        const [a, r] = profile[j];
        const angle = ((t + a) / teeth) * Math.PI * 2;
        const x = Math.cos(angle) * radius * r;
        const y = Math.sin(angle) * radius * r;
        if (t === 0 && j === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
    shape.closePath();
    const hole = new T.Path();
    hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geometry = new T.ExtrudeGeometry(shape, {
      depth,
      steps: 12,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.032,
      bevelThickness: 0.032,
      curveSegments: 80,
    });
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const angle = (z / depth) * twist;
      const x = pos.getX(i),
        y = pos.getY(i);
      pos.setXYZ(
        i,
        x * Math.cos(angle) - y * Math.sin(angle),
        x * Math.sin(angle) + y * Math.cos(angle),
        z - depth / 2,
      );
    }
    geometry.computeVertexNormals();
    return geometry;
  }
  function ring(outer: number, inner: number, depth: number) {
    const shape = new T.Shape();
    shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const hole = new T.Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = new T.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 3,
      curveSegments: 100,
      steps: 1,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  }
  function part(
    geometry: Three.BufferGeometry,
    material: Three.Material,
    x: number,
    y: number,
    z: number,
    open: number,
  ) {
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.userData.closed = z;
    mesh.userData.open = open;
    group.add(mesh);
    parts.push(mesh);
    return mesh;
  }
  const wheel = part(
    gear(32, 2.05, 1.14, 0.78, 0.19),
    materials.orange,
    0.5,
    -0.2,
    0.05,
    0.6,
  );
  wheel.rotation.z = 0.07;
  part(ring(1.15, 0.91, 0.86), materials.graphite, 0.5, -0.2, 0.08, 1.45);
  part(ring(0.94, 0.48, 0.32), materials.ivory, 0.5, -0.2, 0.28, 2.2);
  part(ring(0.52, 0.32, 0.45), materials.metal, 0.5, -0.2, 0.4, 2.85);
  part(
    gear(20, 1.29, 0.42, 0.67, -0.24),
    materials.ivory,
    -2.35,
    1.18,
    -0.04,
    -0.65,
  );
  part(ring(0.46, 0.25, 0.77), materials.graphite, -2.35, 1.18, 0.02, -1.1);
  part(ring(1.78, 1.15, 0.18), materials.graphite, 0.5, -0.2, -0.56, -1.65);
  const detailMaterial = new T.MeshStandardMaterial({
    color: 0xcc541e,
    roughness: 0.55,
    metalness: 0.02,
  });
  for (let i = 0; i < 5; i++) {
    const detail = part(
      new T.TorusGeometry(1.57 + i * 0.055, 0.004, 3, 100),
      detailMaterial,
      0.5,
      -0.2,
      0.446,
      0.996,
    );
    detail.rotation.z = 0.2;
  }
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const x = 0.5 + Math.cos(angle) * 1.52,
      y = -0.2 + Math.sin(angle) * 1.52;
    const bolt = part(
      new T.CylinderGeometry(0.085, 0.085, 0.1, 6),
      materials.metal,
      x,
      y,
      0.48,
      0.98,
    );
    bolt.rotation.x = Math.PI / 2;
  }
  return {
    group,
    parts,
    dispose() {
      group.traverse((object) => {
        if (object instanceof T.Mesh) object.geometry.dispose();
      });
      Object.values(materials).forEach((m) => m.dispose());
      detailMaterial.dispose();
    },
  };
}
