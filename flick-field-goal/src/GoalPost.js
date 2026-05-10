// GoalPost — yellow uprights at a configurable distance. Owns the
// crossbar / posts geometry and the made/missed detection.
//
// Goal frame (world coords, +z is downfield):
//   crossbarY = 3.05   (real NFL = 10ft = 3.05m)
//   uprightsHalfW = 1.83 default (real spacing 18'6" = 5.64m → halfW = 2.82,
//                                  scaled here for legibility on mobile)
//   distance       — z position; settable per kick.
//
// Detection: we sample the ball's trajectory each frame and check
// when ball.z crosses the crossbar plane. If the ball is above the
// crossbar AND between the two uprights at that moment → made. If
// it grazes the post (within POST_RADIUS) → mark hitPost flag for the
// caller (still counts as missed — but Game shakes the camera).
import * as THREE from "three";

const CROSSBAR_Y = 3.05;
const POST_HEIGHT = 9.0;        // total post height above crossbar
const POST_RADIUS = 0.10;
const BASE_HEIGHT = 1.5;        // height from ground to crossbar attachment
const POST_COLOR = 0xffd03a;

export class GoalPost {
  constructor(scene) {
    this.scene = scene;
    this.distance = 20;          // yards (translated 1:1 to world units)
    this.halfWidth = 1.83;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this._build();
    this._lastBallZ = 0;         // tracks ball z to detect crossing
  }

  _build() {
    const m = new THREE.MeshLambertMaterial({ color: POST_COLOR, emissive: 0x6a4a00, emissiveIntensity: 0.4 });
    const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, POST_HEIGHT, 8);
    const baseGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, BASE_HEIGHT, 8);
    // Vertical base under the crossbar (the "y" of the uprights)
    const base = new THREE.Mesh(baseGeo, m);
    base.position.set(0, BASE_HEIGHT / 2, 0);
    this.group.add(base);
    // Crossbar
    const crossbarGeo = new THREE.BoxGeometry(this.halfWidth * 2, 0.18, 0.18);
    const crossbar = new THREE.Mesh(crossbarGeo, m);
    crossbar.position.set(0, CROSSBAR_Y, 0);
    this.crossbar = crossbar;
    this.group.add(crossbar);
    // Left + right uprights
    const left = new THREE.Mesh(postGeo, m);
    left.position.set(-this.halfWidth, CROSSBAR_Y + POST_HEIGHT / 2, 0);
    this.left = left;
    this.group.add(left);
    const right = new THREE.Mesh(postGeo, m);
    right.position.set(this.halfWidth, CROSSBAR_Y + POST_HEIGHT / 2, 0);
    this.right = right;
    this.group.add(right);
  }

  setDistance(yards) {
    this.distance = yards;
    this.group.position.z = yards;
  }

  setWidth(halfW) {
    if (Math.abs(halfW - this.halfWidth) < 0.001) return;
    this.halfWidth = halfW;
    // Rebuild crossbar + reposition uprights without tearing down the group.
    this.group.remove(this.crossbar, this.left, this.right);
    const m = this.left.material;
    const crossbarGeo = new THREE.BoxGeometry(halfW * 2, 0.18, 0.18);
    this.crossbar = new THREE.Mesh(crossbarGeo, m);
    this.crossbar.position.set(0, CROSSBAR_Y, 0);
    this.group.add(this.crossbar);
    const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, POST_HEIGHT, 8);
    this.left  = new THREE.Mesh(postGeo, m);
    this.right = new THREE.Mesh(postGeo, m);
    this.left.position.set(-halfW, CROSSBAR_Y + POST_HEIGHT / 2, 0);
    this.right.position.set(halfW, CROSSBAR_Y + POST_HEIGHT / 2, 0);
    this.group.add(this.left, this.right);
  }

  // Reset the per-kick crossing tracker so a new ball gets a fresh check.
  beginKick() {
    this._lastBallZ = -1;
    this._resolved = false;
  }

  // Per-frame check. Pass the ball's last frame position and current
  // position. Returns one of:
  //   null               — nothing to report yet
  //   { made, perfect, hitPost, distYards, drift } — kick is resolved
  // Caller should stop testing after a non-null return.
  testCrossing(prev, curr) {
    if (this._resolved) return null;
    const planeZ = this.distance;
    if (prev.z < planeZ && curr.z >= planeZ) {
      // Linear-interpolate to the moment of crossing for precision.
      const t = (planeZ - prev.z) / (curr.z - prev.z);
      const x = prev.x + (curr.x - prev.x) * t;
      const y = prev.y + (curr.y - prev.y) * t;
      const widthOK = Math.abs(x) <= this.halfWidth;
      const heightOK = y >= CROSSBAR_Y;
      // "Perfect" = within 25% of the dead-center line and well above bar.
      const perfect = widthOK && heightOK
        && Math.abs(x) < this.halfWidth * 0.25
        && y > CROSSBAR_Y + 0.5;
      // Post graze: the ball's |x| is within POST_RADIUS + 0.15m of an upright
      const hitPost = !widthOK || Math.abs(Math.abs(x) - this.halfWidth) < POST_RADIUS + 0.15;
      const made = widthOK && heightOK;
      this._resolved = true;
      return { made, perfect, hitPost, distYards: this.distance, drift: x };
    }
    return null;
  }
}
