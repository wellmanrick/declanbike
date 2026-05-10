// Stadium — procedural scenery: ground, yard lines, sideline crowd
// silhouettes, sky, light pylons. Built once at boot; never changes.
import * as THREE from "three";

export function buildStadium(scene) {
  // Ambient + key light. Three.js shadows are off for perf on mobile;
  // the look is night-game saturated rather than physically lit.
  scene.add(new THREE.AmbientLight(0x6a90c0, 0.55));
  const key = new THREE.DirectionalLight(0xfff0c0, 0.95);
  key.position.set(20, 40, -10);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6090ff, 0.35);
  fill.position.set(-20, 30, 30);
  scene.add(fill);

  // Sky dome — large gradient hemisphere via vertex colors.
  const skyGeo = new THREE.SphereGeometry(300, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { topColor:    { value: new THREE.Color(0x0a1018) },
                bottomColor: { value: new THREE.Color(0x2a3858) },
                offset:      { value: 60 } },
    vertexShader: `varying vec3 vWorld; void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
    fragmentShader: `varying vec3 vWorld;
      uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset;
      void main() {
        float h = clamp((vWorld.y + offset) / 200.0, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Ground — green field with subtle stripe pattern.
  const fieldGeo = new THREE.PlaneGeometry(120, 240, 1, 1);
  const fieldMat = new THREE.MeshLambertMaterial({ color: 0x255b30 });
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, 0, 50);
  scene.add(field);

  // Mowed stripes — alternating darker/brighter bands every 5 yards.
  // Each yard ≈ 0.9144m; we use simple 1-unit grid to match the camera tuning.
  for (let i = 0; i < 24; i++) {
    if (i % 2 !== 0) continue;
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 5),
      new THREE.MeshLambertMaterial({ color: 0x2c6938 }),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.005, i * 5 - 35);
    scene.add(stripe);
  }
  // Yard lines — every 5 yards; 10/20/30/etc. labels skipped for simplicity.
  for (let i = 0; i <= 24; i++) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 0.25),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.01, i * 5 - 30);
    scene.add(line);
  }

  // Sideline crowd silhouettes — two long boxes standing in for stands.
  const standGeo = new THREE.BoxGeometry(160, 20, 12);
  const standMat = new THREE.MeshLambertMaterial({ color: 0x10141e });
  const leftStand = new THREE.Mesh(standGeo, standMat);
  leftStand.position.set(-26, 8, 50);
  scene.add(leftStand);
  const rightStand = new THREE.Mesh(standGeo, standMat);
  rightStand.position.set(26, 8, 50);
  scene.add(rightStand);
  // Specks of crowd color on the stands so they read as "people".
  const dotGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  for (let s = 0; s < 2; s++) {
    const sx = s === 0 ? -22 : 22;
    for (let i = 0; i < 220; i++) {
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(Math.random(), 0.45, 0.45),
      }));
      dot.position.set(
        sx + (Math.random() - 0.5) * 6,
        4 + Math.random() * 12,
        Math.random() * 140 - 20,
      );
      scene.add(dot);
    }
  }

  // Light pylons — 4 tall posts at corners of the playfield with
  // bright emissive caps. Subtle but reads as "stadium lights."
  const pylonGeo = new THREE.CylinderGeometry(0.3, 0.4, 30, 6);
  const pylonMat = new THREE.MeshLambertMaterial({ color: 0x222831 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff7d6 });
  const pylonAt = (x, z) => {
    const p = new THREE.Mesh(pylonGeo, pylonMat); p.position.set(x, 15, z); scene.add(p);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 1), lampMat);
    lamp.position.set(x, 30, z); scene.add(lamp);
  };
  pylonAt(-30,  0); pylonAt( 30,  0);
  pylonAt(-30, 100); pylonAt( 30, 100);

  // Kicker tee marker — small white square at z=0 so the player can
  // see where the ball launches.
  const tee = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  );
  tee.rotation.x = -Math.PI / 2;
  tee.position.set(0, 0.02, 0);
  scene.add(tee);

  return { field, leftStand, rightStand };
}
