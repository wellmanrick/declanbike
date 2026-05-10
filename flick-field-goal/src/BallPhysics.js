// BallPhysics — football trajectory + render mesh.
//
// Custom lightweight projectile physics:
//   - velocity integration with gravity
//   - wind force as a constant lateral acceleration
//   - "spin curve" as a fixed lateral force tied to the spin sign + speed
//     (Magnus-like — the ball curves the way it spins)
//   - rotates the mesh on its long axis to look like a tight spiral
//
// The ball is a stretched ellipsoid + lacing band so it reads as a
// football at small sizes.
import * as THREE from "three";

const GRAVITY = -9.8;            // m/s²; pure projectile, no air drag for now
const SPIN_FORCE = 4.5;          // m/s² lateral per (spin · speed/30)
const TRAIL_LEN = 30;
const REST_HEIGHT = 0.55;        // ball y when at rest on the tee

export class BallPhysics {
  constructor(scene) {
    this.scene = scene;
    this.position = new THREE.Vector3(0, REST_HEIGHT, 0);
    this.prev = this.position.clone();
    this.velocity = new THREE.Vector3();
    this.spin = 0;
    this.thrown = false;
    this.gone = false;
    this.t = 0;
    this.mesh = this._buildMesh();
    this.scene.add(this.mesh);
    this.trail = [];
    this._buildTrailMesh();
  }

  _buildMesh() {
    const g = new THREE.Group();
    // Body — ellipsoid built from a sphere with x-scale.
    const sphere = new THREE.SphereGeometry(0.3, 16, 12);
    const body = new THREE.Mesh(sphere, new THREE.MeshLambertMaterial({ color: 0x6b3a1d, emissive: 0x1a0a04, emissiveIntensity: 0.2 }));
    body.scale.set(2.0, 1.0, 1.0);   // long axis on +x in local space; we rotate group below to align with velocity
    g.add(body);
    // Lacing — small white band on top.
    const lacingGeo = new THREE.PlaneGeometry(0.45, 0.06);
    const lacing = new THREE.Mesh(lacingGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lacing.position.set(0, 0.32, 0);
    lacing.rotation.x = -Math.PI / 2;
    g.add(lacing);
    // Stripes — two thin white rings near the tips.
    for (const sx of [-0.4, 0.4]) {
      const stripe = new THREE.Mesh(
        new THREE.TorusGeometry(0.20, 0.02, 6, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      stripe.position.set(sx, 0, 0);
      stripe.rotation.y = Math.PI / 2;
      g.add(stripe);
    }
    // Initial orientation: long axis points downfield (+z) so the ball
    // looks like it's pointed where it'll fly.
    g.rotation.y = Math.PI / 2;
    g.position.copy(this.position);
    return g;
  }

  _buildTrailMesh() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    this.trailMesh = new THREE.Line(geo, mat);
    this.scene.add(this.trailMesh);
  }

  reset() {
    this.position.set(0, REST_HEIGHT, 0);
    this.prev.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.spin = 0;
    this.thrown = false;
    this.gone = false;
    this.t = 0;
    this.trail = [];
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(0, Math.PI / 2, 0);
    this._updateTrailGeo();
  }

  canFire() { return !this.thrown && !this.gone; }

  // Fire — kickParams: { vx, vy, vz, spin }
  // The InputController + LevelManager produce these from the drag
  // gesture and the level's distance / kick-angle setting.
  fire({ vx, vy, vz, spin }) {
    this.velocity.set(vx, vy, vz);
    this.spin = spin;
    this.thrown = true;
    this.t = 0;
  }

  update(dt, wind, goal, game) {
    if (!this.thrown || this.gone) return;
    this.prev.copy(this.position);
    this.t += dt;
    // Forces.
    const speed = this.velocity.length();
    const spinForce = SPIN_FORCE * this.spin * (speed / 30);
    this.velocity.x += (wind.x + spinForce) * dt;
    this.velocity.y += GRAVITY * dt;
    this.velocity.z += wind.z * dt;
    // Integrate.
    this.position.addScaledVector(this.velocity, dt);
    // Mesh follows position. Orient long axis along the velocity vector
    // so the ball "points where it's going". A continuous Y-axis spin
    // overlay gives the spiral look.
    this.mesh.position.copy(this.position);
    const v = this.velocity;
    const yaw = Math.atan2(v.x, v.z);
    const pitch = Math.atan2(v.y, Math.sqrt(v.x * v.x + v.z * v.z));
    this.mesh.rotation.set(0, yaw + Math.PI / 2, 0);
    // Spiral spin around the long axis.
    this.mesh.children[0].rotation.x = (this.t * 18) % (Math.PI * 2);
    // Trail.
    this.trail.push(this.position.clone());
    if (this.trail.length > TRAIL_LEN) this.trail.shift();
    this._updateTrailGeo();
    // Crossing the goal plane?
    const outcome = goal.testCrossing(this.prev, this.position);
    if (outcome) {
      this.gone = true;
      // Hand off to Game (which handles scoring + slow-mo + sound).
      game.resolveKick(outcome);
      return;
    }
    // Out-of-bounds termination (ball hits ground or goes way past goal).
    if (this.position.y < 0 || this.position.z > goal.distance + 30 ||
        Math.abs(this.position.x) > 40) {
      // Ball didn't reach the plane — counted as a miss.
      this.gone = true;
      game.resolveKick({ made: false, perfect: false, hitPost: false,
                         distYards: goal.distance, drift: this.position.x });
    }
  }

  _updateTrailGeo() {
    const pos = this.trailMesh.geometry.attributes.position;
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      pos.array[i * 3]     = p.x;
      pos.array[i * 3 + 1] = p.y;
      pos.array[i * 3 + 2] = p.z;
    }
    pos.needsUpdate = true;
    this.trailMesh.geometry.setDrawRange(0, this.trail.length);
  }
}
